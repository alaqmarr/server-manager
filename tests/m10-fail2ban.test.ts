/**
 * Milestone 10: Fail2Ban Security Shield Test Suite
 *
 * Requirements Tested:
 * 1. Fail2Ban Service CLI Command Execution, Resilient Fallback & Store State:
 *    - Status retrieval returns active jails and banned IPs
 *    - In-memory mock store initialized with standard jails ['sshd', 'nginx-http-auth', 'pmmanager-auth']
 *      and sample banned IPs (192.168.1.100, 10.0.0.55)
 *    - Unban dynamically removes targeted IP from store while preserving others
 *    - Graceful handling of unbanning non-existent IP (returns 200 without error)
 * 2. Security Validation & Command Injection Prevention:
 *    - Strict IPv4 and IPv6 address validation
 *    - Strict jail name validation (/^[a-zA-Z0-9_\-]+$/)
 *    - Strict rejection of all shell metacharacters (&, ;, |, `, $, >, <, etc.)
 *    - Injection vectors in IP or jail are blocked with HTTP 400
 * 3. Protected Route Security (RBAC):
 *    - GET /api/fail2ban accessible to any authenticated user (Admin and Developer)
 *    - GET /api/fail2ban returns 401 Unauthorized for unauthenticated requests
 *    - POST /api/fail2ban/unban strictly returns 403 Forbidden for Developer role
 *    - POST /api/fail2ban/unban returns 401 Unauthorized for unauthenticated requests
 *    - POST /api/fail2ban/unban executes successfully (200 OK) for Admin role
 * 4. Input Boundary Handling:
 *    - Missing body, missing jail, or missing IP returns 400 Bad Request
 *    - Malformed JSON returns 400 Bad Request
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import {
  getFail2BanStatus,
  unbanIp,
  validateIp,
  validateJail,
  hasShellMetachars,
  getMockStore,
  resetMockFail2BanStore,
  Fail2BanError,
  SHELL_METACHAR_REGEX,
  JAIL_NAME_REGEX,
} from "../src/lib/fail2ban-service";
import { GET as fail2banGet } from "../src/app/api/fail2ban/route";
import { POST as fail2banUnbanPost } from "../src/app/api/fail2ban/unban/route";

async function runTests() {
  console.log("==================================================================");
  console.log("   Milestone 10: Fail2Ban Security Shield Verification Suite     ");
  console.log("==================================================================\n");

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ ${name}`);
      console.error(`    Error: ${err.message}`);
      if (err.stack) {
        console.error(
          `    Stack: ${err.stack
            .split("\n")
            .slice(1, 4)
            .join("\n")}`
        );
      }
      throw err;
    }
  }

  // =========================================================================
  // Section 1: Security Validation & Injection Prevention
  // =========================================================================
  console.log("--- Section 1: Security Validation & Injection Prevention ---");

  await test("Shell metacharacters are strictly identified and rejected", () => {
    const dangerousChars = [";", "&", "|", "`", "$", ">", "<", "(", ")", "\\", "!"];
    for (const char of dangerousChars) {
      assert.strictEqual(
        hasShellMetachars(`192.168.1.1${char}whoami`),
        true,
        `Expected character "${char}" to trigger shell metacharacter detection`
      );
    }

    assert.strictEqual(hasShellMetachars("192.168.1.100"), false);
    assert.strictEqual(hasShellMetachars("2001:db8::1"), false);
    assert.strictEqual(hasShellMetachars("nginx-http-auth"), false);
  });

  await test("IPv4 validation accepts standard IP addresses and rejects invalid/out-of-range octets", () => {
    // Valid IPv4
    const validIps = ["192.168.1.1", "10.0.0.55", "172.16.254.1", "8.8.8.8", "127.0.0.1", "0.0.0.0"];
    for (const ip of validIps) {
      const res = validateIp(ip);
      assert.strictEqual(res.valid, true, `Expected valid IP: ${ip}`);
    }

    // Invalid IPv4
    const invalidIps = [
      "256.0.0.1",
      "999.999.999.999",
      "192.168.1",
      "192.168.1.1.1",
      "not-an-ip",
      "192.168.1.a",
      "",
      "   ",
    ];
    for (const ip of invalidIps) {
      const res = validateIp(ip);
      assert.strictEqual(res.valid, false, `Expected invalid IP: ${ip}`);
    }
  });

  await test("IPv6 validation accepts valid IPv6 addresses", () => {
    const validIpv6 = [
      "::1",
      "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
      "2001:db8::1",
      "fe80::1",
    ];
    for (const ip of validIpv6) {
      const res = validateIp(ip);
      assert.strictEqual(res.valid, true, `Expected valid IPv6: ${ip}`);
    }
  });

  await test("IP validation strictly rejects adversarial command injection vectors", () => {
    const vectors = [
      "192.168.1.1; whoami",
      "10.0.0.1 && cat /etc/passwd",
      "127.0.0.1 | id",
      "`echo pwned`",
      "$(whoami)",
      "192.168.1.100; rm -rf /",
      "10.0.0.1 | bash",
      "192.168.1.1 > /dev/null",
      "192.168.1.1 & calc.exe",
    ];
    for (const vector of vectors) {
      const res = validateIp(vector);
      assert.strictEqual(
        res.valid,
        false,
        `Expected injection vector "${vector}" to be rejected by validateIp`
      );
    }
  });

  await test("Jail validation accepts valid jail names and rejects invalid/injection strings", () => {
    const validJails = ["sshd", "nginx-http-auth", "pmmanager-auth", "recidive", "apache_badbots"];
    for (const jail of validJails) {
      const res = validateJail(jail);
      assert.strictEqual(res.valid, true, `Expected valid jail: ${jail}`);
    }

    const invalidJails = [
      "sshd; ls -la",
      "jail&whoami",
      "jail|cat",
      "jail`echo`",
      "jail$(id)",
      "jail name with spaces",
      "jail/with/slash",
      "",
      "   ",
    ];
    for (const jail of invalidJails) {
      const res = validateJail(jail);
      assert.strictEqual(res.valid, false, `Expected invalid jail: ${jail}`);
    }
  });

  // =========================================================================
  // Section 2: Fail2Ban Service State & Mock Store Fallback
  // =========================================================================
  console.log("\n--- Section 2: Fail2Ban Service & Fallback State ---");

  await test("getFail2BanStatus returns standard jails and sample banned IPs in mock store", async () => {
    resetMockFail2BanStore();

    const status = await getFail2BanStatus();
    assert.strictEqual(status.success, true);
    assert.strictEqual(Array.isArray(status.jails), true);
    assert.strictEqual(Array.isArray(status.bannedList), true);

    // Verify standard jails
    assert.strictEqual(status.jails.includes("sshd"), true);
    assert.strictEqual(status.jails.includes("nginx-http-auth"), true);
    assert.strictEqual(status.jails.includes("pmmanager-auth"), true);

    // Verify sample banned IPs
    const sshdBanned = status.bannedList.find((b) => b.ip === "192.168.1.100" && b.jail === "sshd");
    assert.ok(sshdBanned, "Expected 192.168.1.100 in sshd jail");

    const nginxBanned = status.bannedList.find((b) => b.ip === "10.0.0.55" && b.jail === "nginx-http-auth");
    assert.ok(nginxBanned, "Expected 10.0.0.55 in nginx-http-auth jail");
  });

  await test("unbanIp removes targeted IP from mock store and preserves other banned IPs", async () => {
    resetMockFail2BanStore();

    const res = await unbanIp({ jail: "sshd", ip: "192.168.1.100" });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.message, "IP 192.168.1.100 unbanned from jail sshd");

    const status = await getFail2BanStatus();
    const removed = status.bannedList.find((b) => b.ip === "192.168.1.100" && b.jail === "sshd");
    assert.strictEqual(removed, undefined, "192.168.1.100 should no longer be in bannedList");

    const preserved = status.bannedList.find((b) => b.ip === "10.0.0.55" && b.jail === "nginx-http-auth");
    assert.ok(preserved, "10.0.0.55 in nginx-http-auth should be preserved");
  });

  await test("unbanIp handles non-existent IP gracefully without crashing or throwing 500", async () => {
    resetMockFail2BanStore();

    const res = await unbanIp({ jail: "sshd", ip: "203.0.113.199" });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.message, "IP 203.0.113.199 unbanned from jail sshd");
  });

  await test("unbanIp throws Fail2BanError (400) when given invalid IP or jail", async () => {
    await assert.rejects(
      async () => {
        await unbanIp({ jail: "sshd", ip: "invalid-ip-string" });
      },
      (err: any) => err instanceof Fail2BanError && err.statusCode === 400
    );

    await assert.rejects(
      async () => {
        await unbanIp({ jail: "sshd; whoami", ip: "192.168.1.1" });
      },
      (err: any) => err instanceof Fail2BanError && err.statusCode === 400
    );
  });

  // =========================================================================
  // Section 3: API Route Protection (RBAC) & Execution
  // =========================================================================
  console.log("\n--- Section 3: API Route Protection & RBAC ---");

  await test("GET /api/fail2ban returns 401 Unauthorized for unauthenticated requests", async () => {
    const req = new Request("http://localhost:3000/api/fail2ban", {
      method: "GET",
      headers: { "x-mock-role": "anonymous" },
    });
    const res = await fail2banGet(req);
    assert.strictEqual(res.status, 401);
  });

  await test("GET /api/fail2ban succeeds (200) for Developer role and returns active jails and banned IPs", async () => {
    resetMockFail2BanStore();

    const req = new Request("http://localhost:3000/api/fail2ban", {
      method: "GET",
      headers: { "x-mock-role": "developer" },
    });
    const res = await fail2banGet(req);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(Array.isArray(data.jails), true);
    assert.strictEqual(Array.isArray(data.bannedList), true);
    assert.ok(data.jails.length > 0);
  });

  await test("GET /api/fail2ban succeeds (200) for Admin role", async () => {
    const req = new Request("http://localhost:3000/api/fail2ban", {
      method: "GET",
      headers: { "x-mock-role": "admin" },
    });
    const res = await fail2banGet(req);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(Array.isArray(data.jails), true);
    assert.strictEqual(Array.isArray(data.bannedList), true);
  });

  await test("POST /api/fail2ban/unban returns 401 Unauthorized for unauthenticated requests", async () => {
    const req = new Request("http://localhost:3000/api/fail2ban/unban", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-role": "anonymous",
      },
      body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
    });
    const res = await fail2banUnbanPost(req);
    assert.strictEqual(res.status, 401);
  });

  await test("POST /api/fail2ban/unban strictly returns 403 Forbidden for Developer role", async () => {
    const req = new Request("http://localhost:3000/api/fail2ban/unban", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-role": "developer",
      },
      body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
    });
    const res = await fail2banUnbanPost(req);
    assert.strictEqual(res.status, 403, `Expected 403 for Developer role, got ${res.status}`);
  });

  await test("POST /api/fail2ban/unban returns 400 Bad Request for missing body or invalid JSON", async () => {
    const req1 = new Request("http://localhost:3000/api/fail2ban/unban", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-role": "admin",
      },
      body: "not-json{",
    });
    const res1 = await fail2banUnbanPost(req1);
    assert.strictEqual(res1.status, 400);

    const req2 = new Request("http://localhost:3000/api/fail2ban/unban", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-role": "admin",
      },
      body: JSON.stringify({}),
    });
    const res2 = await fail2banUnbanPost(req2);
    assert.strictEqual(res2.status, 400);
  });

  await test("POST /api/fail2ban/unban returns 400 Bad Request when jail parameter is missing", async () => {
    const req = new Request("http://localhost:3000/api/fail2ban/unban", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-role": "admin",
      },
      body: JSON.stringify({ ip: "192.168.1.100" }),
    });
    const res = await fail2banUnbanPost(req);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("jail"));
  });

  await test("POST /api/fail2ban/unban returns 400 Bad Request when ip parameter is missing", async () => {
    const req = new Request("http://localhost:3000/api/fail2ban/unban", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-role": "admin",
      },
      body: JSON.stringify({ jail: "sshd" }),
    });
    const res = await fail2banUnbanPost(req);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("IP"));
  });

  await test("POST /api/fail2ban/unban strictly sanitizes shell metacharacters in IP address", async () => {
    const injectionVectors = [
      "192.168.1.1; whoami",
      "10.0.0.1 && cat /etc/passwd",
      "127.0.0.1 | id",
      "`echo pwned`",
      "$(whoami)",
    ];

    for (const badIp of injectionVectors) {
      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "admin",
        },
        body: JSON.stringify({ jail: "sshd", ip: badIp }),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(res.status, 400, `Expected 400 for injection payload "${badIp}", got ${res.status}`);
    }
  });

  await test("POST /api/fail2ban/unban unbans IP for Admin role and returns success message", async () => {
    resetMockFail2BanStore();

    const req = new Request("http://localhost:3000/api/fail2ban/unban", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-role": "admin",
      },
      body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
    });
    const res = await fail2banUnbanPost(req);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.message, "IP 192.168.1.100 unbanned from jail sshd");

    // Verify unbanned from subsequent GET query
    const checkReq = new Request("http://localhost:3000/api/fail2ban", {
      method: "GET",
      headers: { "x-mock-role": "admin" },
    });
    const checkRes = await fail2banGet(checkReq);
    const checkData = await checkRes.json();
    const isPresent = checkData.bannedList.some(
      (b: any) => b.ip === "192.168.1.100" && b.jail === "sshd"
    );
    assert.strictEqual(isPresent, false, "192.168.1.100 must be removed from status list");
  });

  await test("POST /api/fail2ban/unban handles unbanning an IP not present in jail gracefully (200)", async () => {
    const req = new Request("http://localhost:3000/api/fail2ban/unban", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-role": "admin",
      },
      body: JSON.stringify({ jail: "sshd", ip: "203.0.113.199" }),
    });
    const res = await fail2banUnbanPost(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
  });

  console.log("\n==================================================================");
  console.log(`  All ${total} Milestone 10 tests passed successfully! (${passed}/${total})`);
  console.log("==================================================================\n");
}

runTests().catch((err) => {
  console.error("\nTest suite failed with uncaught exception:", err);
  process.exit(1);
});
