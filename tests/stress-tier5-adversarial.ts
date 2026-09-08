import fs from "fs";
import path from "path";
import { TestClient } from "./e2e/client";
import { db } from "../src/lib/db";

interface CheckResult {
  requirement: string;
  testName: string;
  passed: boolean;
  details?: string;
}

const results: CheckResult[] = [];

function record(requirement: string, testName: string, passed: boolean, details?: string) {
  results.push({ requirement, testName, passed, details });
  const icon = passed ? "✔ PASS" : "✖ FAIL";
  console.log(`[${icon}] [${requirement}] ${testName}`);
  if (!passed && details) {
    console.error(`       Details: ${details}`);
  }
}

async function runAdversarialStressSuite() {
  console.log("=================================================================");
  console.log("   TIER 5 ADVERSARIAL STRESS TEST & FULL SYSTEM VERIFICATION   ");
  console.log("=================================================================\n");

  const baseUrl = process.env.TEST_SERVER_URL || "http://localhost:3000";
  const client = new TestClient(baseUrl);
  const anon = client.createAnonymousClient();

  // =========================================================================
  // SECTION 1: REQUIREMENT R1 - AUTHENTICATION & ADMIN SETUP
  // =========================================================================
  console.log("\n--- [R1] Authentication & Admin Setup Stress Tests ---");

  // 1.1: Unauthenticated GET / redirects to /login
  try {
    const res = await anon.fetch("/", { followRedirects: false });
    const location = res.headers.get("location") || "";
    const isRedirect = res.status === 307 || res.status === 302;
    record(
      "R1-Auth",
      "1.1: Unauthenticated GET / returns HTTP 307/302 redirect to /login",
      isRedirect && location.includes("/login"),
      `Status: ${res.status}, Location: ${location}`
    );
  } catch (err: any) {
    record("R1-Auth", "1.1: Unauthenticated GET / redirects to /login", false, err.message);
  }

  // 1.2: GET /setup when admin exists redirects to /login
  try {
    const res = await anon.fetch("/setup", { followRedirects: false });
    const location = res.headers.get("location") || "";
    const isRedirect = res.status === 307 || res.status === 302;
    record(
      "R1-Auth",
      "1.2: Unauthenticated GET /setup redirects to /login when admin exists",
      isRedirect && location.includes("/login"),
      `Status: ${res.status}, Location: ${location}`
    );
  } catch (err: any) {
    record("R1-Auth", "1.2: Unauthenticated GET /setup redirects to /login", false, err.message);
  }

  // 1.3: Unauthenticated API route protection (PM2, Ports, Nginx, Terminal)
  const protectedEndpoints = [
    { method: "GET", path: "/api/pm2" },
    { method: "GET", path: "/api/ports" },
    { method: "GET", path: "/api/nginx/files" },
    { method: "GET", path: "/api/nginx/content?file=nginx.conf" },
    { method: "POST", path: "/api/nginx/save", body: { relativePath: "test.conf", content: "test" } },
    { method: "POST", path: "/api/terminal/execute", body: { command: "echo fail" } },
  ];

  for (const ep of protectedEndpoints) {
    try {
      const res = await anon.fetch(ep.path, {
        method: ep.method,
        headers: ep.body ? { "content-type": "application/json" } : {},
        body: ep.body ? JSON.stringify(ep.body) : undefined,
        followRedirects: false,
      });
      const isBlocked = res.status === 401 || res.status === 403 || res.status === 307 || res.status === 302;
      record(
        "R1-Auth",
        `1.3: Unauthenticated ${ep.method} ${ep.path} rejected (${res.status})`,
        isBlocked,
        `Status: ${res.status}`
      );
    } catch (err: any) {
      record("R1-Auth", `1.3: Unauthenticated ${ep.method} ${ep.path}`, false, err.message);
    }
  }

  // 1.4: Forged session cookie rejected
  try {
    const forgedClient = client.createAnonymousClient();
    forgedClient.setCookie("authjs.session-token", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake");
    const res = await forgedClient.fetch("/api/pm2", { followRedirects: false });
    const isBlocked = res.status === 401 || res.status === 403 || res.status === 307 || res.status === 302;
    record(
      "R1-Auth",
      "1.4: Access with forged authjs.session-token rejected",
      isBlocked,
      `Status: ${res.status}`
    );
  } catch (err: any) {
    record("R1-Auth", "1.4: Forged session cookie rejected", false, err.message);
  }

  // 1.5: Secondary admin creation attempt via POST /api/setup
  try {
    const res = await anon.post("/api/setup", {
      username: "attacker_admin_2",
      password: "somepassword123",
    });
    record(
      "R1-Auth",
      "1.5: Secondary admin creation attempt rejected with HTTP 400",
      res.status === 400 && (res.data?.error === "Admin already exists" || res.data?.message?.includes("already exists")),
      `Status: ${res.status}, Body: ${JSON.stringify(res.data)}`
    );
  } catch (err: any) {
    record("R1-Auth", "1.5: Secondary admin creation attempt", false, err.message);
  }

  // 1.6: Concurrent burst of 10 secondary admin creation requests
  try {
    const burstPromises = Array.from({ length: 10 }, (_, i) =>
      anon.post("/api/setup", {
        username: `concurrent_hacker_${i}`,
        password: `Password_${i}_123`,
      })
    );
    const burstResponses = await Promise.all(burstPromises);
    const allRejected = burstResponses.every((r) => r.status === 400);
    record(
      "R1-Auth",
      "1.6: Burst of 10 concurrent secondary admin creation requests ALL rejected with 400",
      allRejected,
      `Statuses: ${burstResponses.map((r) => r.status).join(", ")}`
    );
  } catch (err: any) {
    record("R1-Auth", "1.6: Concurrent burst of secondary admin creation", false, err.message);
  }

  // 1.7: Direct SQLite trigger whitebox verification
  try {
    let triggerBlocked = false;
    try {
      db.prepare(
        "INSERT INTO users (username, passwordHash, role) VALUES (?, ?, ?)"
      ).run("sql_direct_intruder", "hash", "admin");
    } catch (dbErr: any) {
      if (dbErr.message.includes("Admin already exists")) {
        triggerBlocked = true;
      }
    }
    record(
      "R1-Auth",
      "1.7: SQLite database trigger one_admin_only strictly aborts direct INSERT",
      triggerBlocked,
      `Trigger blocked: ${triggerBlocked}`
    );
  } catch (err: any) {
    record("R1-Auth", "1.7: Direct SQLite trigger", false, err.message);
  }

  // 1.8: Credentials Login Verification
  try {
    // Valid login
    const validLogin = await client.login("admin", "password123");
    record(
      "R1-Auth",
      "1.8: NextAuth login with valid admin credentials succeeds",
      validLogin.success,
      `Success: ${validLogin.success}`
    );

    // Invalid password login
    const badPassClient = client.createAnonymousClient();
    const badPassLogin = await badPassClient.login("admin", "wrong_password_999");
    record(
      "R1-Auth",
      "1.9: NextAuth login with incorrect password fails",
      !badPassLogin.success,
      `Success: ${badPassLogin.success}`
    );

    // Nonexistent user login
    const ghostClient = client.createAnonymousClient();
    const ghostLogin = await ghostClient.login("nonexistent_admin_xyz", "password123");
    record(
      "R1-Auth",
      "1.10: NextAuth login with nonexistent username fails",
      !ghostLogin.success,
      `Success: ${ghostLogin.success}`
    );

    // SQL Injection vector in login
    const sqliClient = client.createAnonymousClient();
    const sqliLogin = await sqliClient.login("' OR '1'='1' --", "password123");
    record(
      "R1-Auth",
      "1.11: NextAuth login with SQL injection vector fails safely",
      !sqliLogin.success,
      `Success: ${sqliLogin.success}`
    );
  } catch (err: any) {
    record("R1-Auth", "1.8-1.11: Credentials login verification", false, err.message);
  }

  // =========================================================================
  // SECTION 2: REQUIREMENT R2 - PM2 MANAGEMENT & MONITORING
  // =========================================================================
  console.log("\n--- [R2] PM2 Management & Monitoring Stress Tests ---");

  // 2.1: PM2 Process Listing & Summary Invariants
  try {
    const res = await client.get<any>("/api/pm2");
    const valid =
      res.status === 200 &&
      res.data?.success === true &&
      Array.isArray(res.data?.processes) &&
      res.data.processes.length > 0 &&
      res.data.summary &&
      typeof res.data.summary.total === "number" &&
      typeof res.data.summary.online === "number" &&
      typeof res.data.summary.stopped === "number" &&
      res.data.summary.total === res.data.summary.online + res.data.summary.stopped;

    record(
      "R2-PM2",
      "2.1: GET /api/pm2 returns process list and valid summary invariants",
      valid,
      `Status: ${res.status}, processes: ${res.data?.processes?.length}, summary: ${JSON.stringify(res.data?.summary)}`
    );
  } catch (err: any) {
    record("R2-PM2", "2.1: PM2 process listing", false, err.message);
  }

  // 2.2: Metrics Fluctuation & Polling Jitter
  try {
    const samples: Array<{ cpu: number; memory: number }> = [];
    for (let i = 0; i < 4; i++) {
      const res = await client.get<any>("/api/pm2");
      const p0 = res.data?.processes?.[0];
      if (p0) {
        samples.push({ cpu: p0.cpu, memory: p0.memory });
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    const allValidNumbers = samples.every(
      (s) => typeof s.cpu === "number" && !isNaN(s.cpu) && s.cpu >= 0 && typeof s.memory === "number" && s.memory > 0
    );
    record(
      "R2-PM2",
      "2.2: Periodic polling captures valid numeric CPU & Memory metrics",
      samples.length === 4 && allValidNumbers,
      `Samples: ${JSON.stringify(samples)}`
    );
  } catch (err: any) {
    record("R2-PM2", "2.2: Metrics fluctuation", false, err.message);
  }

  // 2.3: Process Stop Action
  try {
    const stopRes = await client.post<any>("/api/pm2/action", { action: "stop", id: "0" });
    const verifyRes = await client.get<any>("/api/pm2");
    const p0 = verifyRes.data?.processes?.find((p: any) => String(p.id) === "0");
    record(
      "R2-PM2",
      "2.3: POST /api/pm2/action stop sets process status to stopped",
      stopRes.status === 200 && stopRes.data?.success === true && p0?.status === "stopped" && p0?.cpu === 0,
      `Action res: ${JSON.stringify(stopRes.data)}, Status: ${p0?.status}, CPU: ${p0?.cpu}`
    );
  } catch (err: any) {
    record("R2-PM2", "2.3: Process stop action", false, err.message);
  }

  // 2.4: Process Restart Action
  try {
    const restartRes = await client.post<any>("/api/pm2/action", { action: "restart", id: "0" });
    const verifyRes = await client.get<any>("/api/pm2");
    const p0 = verifyRes.data?.processes?.find((p: any) => String(p.id) === "0");
    record(
      "R2-PM2",
      "2.4: POST /api/pm2/action restart restarts process and sets status to online",
      restartRes.status === 200 && restartRes.data?.success === true && p0?.status === "online",
      `Action res: ${JSON.stringify(restartRes.data)}, Status: ${p0?.status}, restarts: ${p0?.restarts}`
    );
  } catch (err: any) {
    record("R2-PM2", "2.4: Process restart action", false, err.message);
  }

  // 2.5: Process Start Action
  try {
    // First stop it again
    await client.post<any>("/api/pm2/action", { action: "stop", id: "0" });
    const startRes = await client.post<any>("/api/pm2/action", { action: "start", id: "0" });
    const verifyRes = await client.get<any>("/api/pm2");
    const p0 = verifyRes.data?.processes?.find((p: any) => String(p.id) === "0");
    record(
      "R2-PM2",
      "2.5: POST /api/pm2/action start sets process status to online",
      startRes.status === 200 && startRes.data?.success === true && p0?.status === "online",
      `Action res: ${JSON.stringify(startRes.data)}, Status: ${p0?.status}`
    );
  } catch (err: any) {
    record("R2-PM2", "2.5: Process start action", false, err.message);
  }

  // 2.6: Metacharacter Injection Defense in PM2 Actions
  const injectionIds = ["0; echo hacked", "0 && dir", "0|calc", "$(whoami)", "`reboot`", "0 > file"];
  for (const maliciousId of injectionIds) {
    try {
      const res = await client.post<any>("/api/pm2/action", { action: "restart", id: maliciousId });
      record(
        "R2-PM2",
        `2.6: Injection ID '${maliciousId}' rejected with HTTP 400`,
        res.status === 400,
        `Status: ${res.status}, body: ${JSON.stringify(res.data)}`
      );
    } catch (err: any) {
      record("R2-PM2", `2.6: Injection ID '${maliciousId}'`, false, err.message);
    }
  }

  // =========================================================================
  // SECTION 3: REQUIREMENT R3 - PORT & NGINX MANAGEMENT
  // =========================================================================
  console.log("\n--- [R3] Port & Nginx Management Stress Tests ---");

  // 3.1: Port Discovery Verification
  try {
    const res = await client.get<any>("/api/ports");
    const validPorts =
      res.status === 200 &&
      res.data?.success === true &&
      Array.isArray(res.data?.ports) &&
      res.data.ports.length > 0 &&
      res.data.ports.every(
        (p: any) =>
          typeof p.port === "number" &&
          p.port >= 1 &&
          p.port <= 65535 &&
          (p.protocol === "TCP" || p.protocol === "UDP") &&
          typeof p.address === "string" &&
          typeof p.process === "string"
      );

    record(
      "R3-Ports-Nginx",
      "3.1: GET /api/ports discovers active listening ports within bounds 1-65535",
      validPorts,
      `Status: ${res.status}, mode: ${res.data?.mode}, count: ${res.data?.ports?.length}`
    );
  } catch (err: any) {
    record("R3-Ports-Nginx", "3.1: Port discovery", false, err.message);
  }

  // 3.2: Nginx File Scanner
  try {
    const res = await client.get<any>("/api/nginx/files");
    const hasNginxConf = res.data?.files?.some((f: any) => f.name === "nginx.conf" || f.relativePath === "nginx.conf");
    record(
      "R3-Ports-Nginx",
      "3.2: GET /api/nginx/files enumerates configuration files including nginx.conf",
      res.status === 200 && res.data?.success === true && hasNginxConf,
      `Status: ${res.status}, files: ${JSON.stringify(res.data?.files?.map((f: any) => f.relativePath))}`
    );
  } catch (err: any) {
    record("R3-Ports-Nginx", "3.2: Nginx file scanner", false, err.message);
  }

  // 3.3: Nginx Content Reader
  try {
    const res = await client.get<any>("/api/nginx/content?file=nginx.conf");
    record(
      "R3-Ports-Nginx",
      "3.3: GET /api/nginx/content?file=nginx.conf reads valid config content",
      res.status === 200 && res.data?.success === true && typeof res.data?.content === "string" && res.data.content.length > 10,
      `Status: ${res.status}, length: ${res.data?.content?.length}`
    );
  } catch (err: any) {
    record("R3-Ports-Nginx", "3.3: Nginx content reader", false, err.message);
  }

  // 3.4: Nginx Path Traversal Lockdown (Strict HTTP 403)
  const traversalVectors = [
    "../../../../windows/win.ini",
    "..%2F..%2F..%2F..%2Fetc%2Fpasswd",
    "conf.d/../../data.db",
    "C:\\Windows\\System32\\drivers\\etc\\hosts",
    "/etc/shadow",
    ".\\..\\..\\..\\package.json",
    "%2e%2e%2f%2e%2e%2fpackage.json",
    "..%252f..%252fetc%252fpasswd",
  ];

  for (const vector of traversalVectors) {
    try {
      const res = await client.get<any>(`/api/nginx/content?file=${encodeURIComponent(vector)}`);
      record(
        "R3-Ports-Nginx",
        `3.4: Path traversal attempt '${vector}' blocked with HTTP 403`,
        res.status === 403,
        `Status: ${res.status}, body: ${JSON.stringify(res.data)}`
      );
    } catch (err: any) {
      record("R3-Ports-Nginx", `3.4: Traversal vector '${vector}'`, false, err.message);
    }
  }

  // 3.5: Non-existent file inside valid base returns 404 (not 403, not 500)
  try {
    const res = await client.get<any>("/api/nginx/content?file=conf.d/definitely_absent_98765.conf");
    record(
      "R3-Ports-Nginx",
      "3.5: Non-existent file in valid directory returns clean HTTP 404",
      res.status === 404,
      `Status: ${res.status}`
    );
  } catch (err: any) {
    record("R3-Ports-Nginx", "3.5: Non-existent file", false, err.message);
  }

  // 3.6: Nginx Save Persistence & .bak Backup Creation
  try {
    const targetFile = "conf.d/pmmanager.conf";
    // 1. Read existing content
    const originalRes = await client.get<any>(`/api/nginx/content?file=${targetFile}`);
    const originalContent = originalRes.data?.content || "";

    const marker = `# STRESS_TEST_MARKER_${Date.now()}`;
    const modifiedContent = `${originalContent}\n${marker}\n`;

    // 2. Save modified content
    const saveRes = await client.post<any>("/api/nginx/save", {
      relativePath: targetFile,
      content: modifiedContent,
    });

    // 3. Verify .bak exists on disk
    const simDir = path.resolve(process.cwd(), "simulated_nginx");
    const targetDiskPath = path.join(simDir, "conf.d", "pmmanager.conf");
    const backupDiskPath = `${targetDiskPath}.bak`;
    const backupExists = fs.existsSync(backupDiskPath);

    // 4. Read back and verify content persisted
    const readBackRes = await client.get<any>(`/api/nginx/content?file=${targetFile}`);
    const contentPersisted = readBackRes.data?.content?.includes(marker);

    // 5. Restore original content
    await client.post<any>("/api/nginx/save", {
      relativePath: targetFile,
      content: originalContent,
    });

    record(
      "R3-Ports-Nginx",
      "3.6: Nginx save persists content and generates .bak backup file",
      saveRes.status === 200 && backupExists && contentPersisted,
      `Save status: ${saveRes.status}, backupExists: ${backupExists}, persisted: ${contentPersisted}`
    );
  } catch (err: any) {
    record("R3-Ports-Nginx", "3.6: Nginx save persistence & backup", false, err.message);
  }

  // =========================================================================
  // SECTION 4: REQUIREMENT R4 - WEB TERMINAL
  // =========================================================================
  console.log("\n--- [R4] Web Terminal Stress Tests ---");

  // 4.1: Verbatim Output Execution: echo "agent-test"
  try {
    const res = await client.post<any>("/api/terminal/execute", {
      command: 'echo "agent-test"',
    });
    const stdoutClean = (res.data?.stdout || "").replace(/\r?\n$/, "").replace(/^"|"$/g, "");
    record(
      "R4-Terminal",
      '4.1: echo "agent-test" returns agent-test verbatim in output log',
      res.status === 200 && stdoutClean === "agent-test" && res.data?.exitCode === 0,
      `Status: ${res.status}, stdout: ${JSON.stringify(res.data?.stdout)}, exitCode: ${res.data?.exitCode}`
    );
  } catch (err: any) {
    record("R4-Terminal", "4.1: echo 'agent-test' execution", false, err.message);
  }

  // 4.2: Stateful Directory Navigation (cd)
  try {
    // Step 1: cd into simulated_nginx
    const cdRes = await client.post<any>("/api/terminal/execute", {
      command: "cd simulated_nginx",
    });
    const newCwd = cdRes.data?.cwd;
    const isNewCwdSimNginx = newCwd && (newCwd.endsWith("simulated_nginx") || newCwd.endsWith("simulated_nginx\\"));

    // Step 2: Execute command in that newCwd
    const checkRes = await client.post<any>("/api/terminal/execute", {
      command: 'node -e "console.log(process.cwd())"',
      cwd: newCwd,
    });
    const executedCwd = (checkRes.data?.stdout || "").trim();

    record(
      "R4-Terminal",
      "4.2: Stateful cd directory navigation updates cwd and executes subsequent commands therein",
      cdRes.status === 200 && isNewCwdSimNginx && executedCwd === newCwd,
      `cd status: ${cdRes.status}, newCwd: ${newCwd}, executedCwd: ${executedCwd}`
    );
  } catch (err: any) {
    record("R4-Terminal", "4.2: Stateful cd navigation", false, err.message);
  }

  // 4.3: Error Handling: Non-zero Exit Codes (No Server Crash)
  try {
    const res = await client.post<any>("/api/terminal/execute", {
      command: 'node -e "process.exit(17)"',
    });
    record(
      "R4-Terminal",
      "4.3: Non-zero exit code (17) returns HTTP 200 with exitCode: 17 without crashing server",
      res.status === 200 && res.data?.exitCode === 17,
      `Status: ${res.status}, exitCode: ${res.data?.exitCode}`
    );
  } catch (err: any) {
    record("R4-Terminal", "4.3: Non-zero exit code error handling", false, err.message);
  }

  // 4.4: Stderr Stream Capture
  try {
    const res = await client.post<any>("/api/terminal/execute", {
      command: 'node -e "console.error(\\"custom-stderr-payload\\")"',
    });
    record(
      "R4-Terminal",
      "4.4: Process writing to stderr captures stream cleanly",
      res.status === 200 && res.data?.stderr?.includes("custom-stderr-payload"),
      `Status: ${res.status}, stderr: ${JSON.stringify(res.data?.stderr)}`
    );
  } catch (err: any) {
    record("R4-Terminal", "4.4: Stderr capture", false, err.message);
  }

  // 4.5: Invalid Directory cd Handling
  try {
    const res = await client.post<any>("/api/terminal/execute", {
      command: "cd totally_imaginary_directory_9999",
    });
    record(
      "R4-Terminal",
      "4.5: cd to non-existent directory handled gracefully with exitCode 1 and stderr explanation",
      res.status === 200 && res.data?.exitCode === 1 && res.data?.stderr?.includes("no such file or directory"),
      `Status: ${res.status}, exitCode: ${res.data?.exitCode}, stderr: ${res.data?.stderr}`
    );
  } catch (err: any) {
    record("R4-Terminal", "4.5: Invalid directory cd handling", false, err.message);
  }

  // 4.6: Concurrent Terminal Execution
  try {
    const commands = ["echo cmd1", "echo cmd2", "echo cmd3", "echo cmd4"];
    const results = await Promise.all(
      commands.map((cmd) => client.post<any>("/api/terminal/execute", { command: cmd }))
    );
    const allSuccessful = results.every(
      (r, idx) => r.status === 200 && r.data?.stdout?.includes(`cmd${idx + 1}`)
    );
    record(
      "R4-Terminal",
      "4.6: Concurrent terminal execution of 4 simultaneous commands executes flawlessly",
      allSuccessful,
      `Statuses: ${results.map((r) => r.status).join(", ")}`
    );
  } catch (err: any) {
    record("R4-Terminal", "4.6: Concurrent terminal execution", false, err.message);
  }

  // =========================================================================
  // SUMMARY REPORT
  // =========================================================================
  console.log("\n=================================================================");
  console.log("             ADVERSARIAL STRESS TEST SUMMARY REPORT              ");
  console.log("=================================================================");

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`Total Stress Tests : ${total}`);
  console.log(`Passed             : ${passed}`);
  console.log(`Failed             : ${failed}`);

  if (failed > 0) {
    console.log("\nFAILED TESTS:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`✖ [${r.requirement}] ${r.testName}: ${r.details}`);
    }
    process.exit(1);
  } else {
    console.log("\nOVERALL STATUS: ALL TIER 5 STRESS TESTS PASSED (100% SUCCESS)\n");
    process.exit(0);
  }
}

runAdversarialStressSuite().catch((err) => {
  console.error("Fatal suite failure:", err);
  process.exit(1);
});
