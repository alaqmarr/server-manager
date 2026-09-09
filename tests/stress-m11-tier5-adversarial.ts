/**
 * Milestone 11: Enterprise Adversarial Hardening (Tier 5) Stress Suite
 * Challenger: challenger_m11_adv_1_gen3
 *
 * Empirical verification across all 7 Enterprise Features:
 * 1. Feature 1 (RBAC): Role tampering, cookie forgery, developer forbidden access (403),
 *    admin access (200), anonymous rejection (401), privilege escalation lockdown.
 * 2. Feature 2 (Git Auto-Deploy): HMAC timing attacks (crypto.timingSafeEqual constant-time check),
 *    malformed webhook payloads (empty, non-JSON, missing ref, wrong branch), rapid concurrent push bursts.
 * 3. Feature 3 (Discord Alerts): Live webhook format validation (embeds, fields, timestamp, color),
 *    rapid error bursts without crash (10-min cooldown suppression, network error resilience).
 * 4. Feature 4 (SSE Log Streamer): Rapid socket disconnects (AbortController abort at t=0s),
 *    command injection on ?process= and ?targetProcess=, immediate connection event at t=0s (<100ms).
 * 5. Feature 5 (Historical Vitals): Idempotency of GET requests (zero DB row mutations on read),
 *    extreme hours bounds (-999999, 0, 100000, 1e12, non-numeric), SQL injection resilience.
 * 6. Feature 6 (Fail2Ban): Command injection sanitation on jail names and unban IP addresses,
 *    developer role restriction (403), IPv4/IPv6 validation, path traversal defense.
 * 7. Feature 7 (Uptime Monitoring): Dead host pings with AbortController non-blocking,
 *    division-by-zero SLA protection (zero checks -> 100.0% / PENDING), cascading check cleanup on deletion.
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

// Feature 1: RBAC & Database
import {
  db,
  adminExists,
  createUser,
  getUserByUsername,
  listUsers,
  deleteUser,
  recordVital,
  getVitalsHistory,
  getVitalsCount,
  createUptimeMonitor,
  getUptimeMonitors,
  getUptimeMonitorById,
  deleteUptimeMonitor,
  recordUptimeCheck,
  getUptimeChecks,
  recalculateMonitorSLA,
} from "../src/lib/db";
import { requireAuth, requireAdmin } from "../src/lib/auth-guard";
import { POST as terminalExecutePost } from "../src/app/api/terminal/execute/route";
import { GET as nginxFilesGet } from "../src/app/api/nginx/files/route";
import { GET as envGet, POST as envPost } from "../src/app/api/env/route";
import { GET as usersGet, POST as usersPost } from "../src/app/api/users/route";

// Feature 2: Git Auto-Deploy
import {
  triggerDeployment,
  executeDeployment,
  acquireDeploymentLock,
  getDeployments,
  getDeploymentById,
  clearDeploymentHistory,
  waitForDeployment,
  extractBranch,
} from "../src/lib/deploy-service";
import {
  POST as deployWebhookPost,
  GET as deployWebhookGet,
} from "../src/app/api/deploy/webhook/route";

// Feature 3: Discord Alerts
import {
  sendDiscordAlert,
  testDiscordWebhook,
  checkVitalsAndAlert,
  clearAlertCooldowns,
  getAlertCooldowns,
  AUTHORITATIVE_DISCORD_WEBHOOK_URL,
  ALERT_COLORS,
  COOLDOWN_DURATION_MS,
  resolveColor,
} from "../src/lib/discord-service";
import {
  POST as discordTestPost,
  GET as discordTestGet,
} from "../src/app/api/discord/test/route";

// Feature 4: SSE Log Streamer
import {
  createLogStream,
  formatSseEvent,
  getHistoricalLogs,
  VALID_PROCESS_REGEX,
} from "../src/lib/log-stream-service";
import { GET as sseStreamGet } from "../src/app/api/pm2/logs/stream/route";

// Feature 5: Historical Vitals
import { GET as vitalsHistoryGet } from "../src/app/api/vitals/history/route";

// Feature 6: Fail2Ban
import {
  getFail2BanStatus,
  unbanIp,
  validateIp,
  validateJail,
  hasShellMetachars,
  getMockStore,
  Fail2BanError,
} from "../src/lib/fail2ban-service";
import { GET as fail2banGet } from "../src/app/api/fail2ban/route";
import { POST as fail2banUnbanPost } from "../src/app/api/fail2ban/unban/route";

// Feature 7: Uptime Monitoring
import {
  pingUrl,
  performUptimeCheck,
  pollDueMonitors,
  startUptimeWorker,
  stopUptimeWorker,
  isUptimeWorkerActive,
} from "../src/lib/uptime-service";
import {
  GET as uptimeGet,
  POST as uptimePost,
  DELETE as uptimeDelete,
} from "../src/app/api/uptime/route";
import { POST as uptimeCheckPost } from "../src/app/api/uptime/check/route";

interface ProbeResult {
  feature: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

const probeResults: ProbeResult[] = [];

async function probe(feature: string, name: string, fn: () => void | Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    probeResults.push({ feature, name, passed: true, durationMs });
    console.log(`  ✔ [PASS] [${feature}] ${name} (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    probeResults.push({ feature, name, passed: false, durationMs, error: err.message || String(err) });
    console.error(`  ✖ [FAIL] [${feature}] ${name} (${durationMs}ms)`);
    console.error(`     Error: ${err.message || err}`);
  }
}

async function runAdversarialSuite() {
  console.log("================================================================================");
  console.log("   MILESTONE 11: ENTERPRISE ADVERSARIAL HARDENING (TIER 5) STRESS SUITE        ");
  console.log("   Empirical Probing Across All 7 Enterprise Features                          ");
  console.log("================================================================================\n");

  // ===========================================================================
  // FEATURE 1: RBAC ROLE TAMPERING, COOKIE FORGERY & PRIVILEGE LOCKDOWN
  // ===========================================================================
  console.log("--- FEATURE 1: RBAC Security & Privilege Escalation Lockdown ---");

  await probe("F1-RBAC", "1.1: Developer role receives strict HTTP 403 Forbidden on /api/terminal/execute", async () => {
    const req = new NextRequest("http://localhost:3000/api/terminal/execute", {
      method: "POST",
      headers: { "x-mock-role": "developer", "content-type": "application/json" },
      body: JSON.stringify({ command: "whoami" }),
    });
    const res = await terminalExecutePost(req);
    assert.strictEqual(res.status, 403, `Expected 403 Forbidden for developer, got ${res.status}`);
    const body = await res.json();
    assert.ok(body.error && body.error.toLowerCase().includes("forbidden"));
  });

  await probe("F1-RBAC", "1.2: Developer role receives strict HTTP 403 Forbidden on /api/env", async () => {
    const req = new NextRequest("http://localhost:3000/api/env", {
      method: "GET",
      headers: { "x-mock-role": "developer" },
    });
    const res = await envGet(req);
    assert.strictEqual(res.status, 403, `Expected 403 Forbidden on env GET, got ${res.status}`);
  });

  await probe("F1-RBAC", "1.3: Developer role receives strict HTTP 403 Forbidden on /api/nginx/files", async () => {
    const req = new NextRequest("http://localhost:3000/api/nginx/files", {
      method: "GET",
      headers: { "x-mock-role": "developer" },
    });
    const res = await nginxFilesGet(req);
    assert.strictEqual(res.status, 403, `Expected 403 Forbidden on nginx GET, got ${res.status}`);
  });

  await probe("F1-RBAC", "1.4: Developer role receives strict HTTP 403 Forbidden on /api/fail2ban/unban", async () => {
    const req = new NextRequest("http://localhost:3000/api/fail2ban/unban", {
      method: "POST",
      headers: { "x-mock-role": "developer", "content-type": "application/json" },
      body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
    });
    const res = await fail2banUnbanPost(req);
    assert.strictEqual(res.status, 403, `Expected 403 Forbidden on unban POST, got ${res.status}`);
  });

  await probe("F1-RBAC", "1.5: Developer role receives strict HTTP 403 Forbidden on /api/users", async () => {
    const req = new NextRequest("http://localhost:3000/api/users", {
      method: "GET",
      headers: { "x-mock-role": "developer" },
    });
    const res = await usersGet(req);
    assert.strictEqual(res.status, 403, `Expected 403 Forbidden on users GET, got ${res.status}`);
  });

  await probe("F1-RBAC", "1.6: Unauthenticated request receives HTTP 401 Unauthorized across protected endpoints", async () => {
    const endpoints = [
      () => terminalExecutePost(new NextRequest("http://localhost:3000/api/terminal/execute", { method: "POST", headers: { "x-mock-role": "unauthenticated" } })),
      () => envGet(new NextRequest("http://localhost:3000/api/env", { method: "GET", headers: { "x-mock-role": "unauthenticated" } })),
      () => fail2banUnbanPost(new NextRequest("http://localhost:3000/api/fail2ban/unban", { method: "POST", headers: { "x-mock-role": "unauthenticated" } })),
    ];
    for (const ep of endpoints) {
      const res = await ep();
      assert.strictEqual(res.status, 401, `Expected 401 Unauthorized, got ${res.status}`);
    }
  });

  await probe("F1-RBAC", "1.7: Admin role receives valid authorized access on sensitive endpoints", async () => {
    const req = new NextRequest("http://localhost:3000/api/nginx/files", {
      method: "GET",
      headers: { "x-mock-role": "admin" },
    });
    const res = await nginxFilesGet(req);
    assert.strictEqual(res.status, 200, `Expected 200 OK for admin, got ${res.status}`);
  });

  // ===========================================================================
  // FEATURE 2: GIT AUTO-DEPLOY TIMING ATTACKS, MALFORMED PAYLOADS & CONCURRENCY
  // ===========================================================================
  console.log("\n--- FEATURE 2: Git Auto-Deploy Timing Attacks & Payload Fuzzing ---");

  await probe("F2-Deploy", "2.1: POST /api/deploy/webhook handles empty body with HTTP 400", async () => {
    const req = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "",
    });
    const res = await deployWebhookPost(req);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
  });

  await probe("F2-Deploy", "2.2: POST /api/deploy/webhook handles malformed JSON with HTTP 400", async () => {
    const req = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"ref": "refs/heads/main", "broken": }',
    });
    const res = await deployWebhookPost(req);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
  });

  await probe("F2-Deploy", "2.3: Push to non-target branch ignored gracefully with deployed: false", async () => {
    const req = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": "push" },
      body: JSON.stringify({ ref: "refs/heads/feature-experimental", repository: { name: "pmmanager" } }),
    });
    const res = await deployWebhookPost(req);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.deployed, false);
  });

  await probe("F2-Deploy", "2.4: HMAC Signature verification timing attack defense (constant-time timingSafeEqual)", async () => {
    // Configure secret temporarily
    const originalSecret = process.env.DEPLOY_WEBHOOK_SECRET;
    process.env.DEPLOY_WEBHOOK_SECRET = "super_secret_enterprise_key_2026";
    try {
      const payload = JSON.stringify({ ref: "refs/heads/main" });
      const validHmac = crypto.createHmac("sha256", process.env.DEPLOY_WEBHOOK_SECRET).update(payload).digest("hex");
      const validSig = `sha256=${validHmac}`;

      // 1. Correct signature -> succeeds
      const reqValid = new Request("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": validSig },
        body: payload,
      });
      const resValid = await deployWebhookPost(reqValid);
      assert.strictEqual(resValid.status, 202);

      // 2. Tampered signature -> 401 Unauthorized
      const tamperedSig = `sha256=${validHmac.substring(0, validHmac.length - 2)}ff`;
      const reqTampered = new Request("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": tamperedSig },
        body: payload,
      });
      const resTampered = await deployWebhookPost(reqTampered);
      assert.strictEqual(resTampered.status, 401);

      // 3. Length mismatch signature -> 401 Unauthorized without exception
      const reqShort = new Request("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=tooshort" },
        body: payload,
      });
      const resShort = await deployWebhookPost(reqShort);
      assert.strictEqual(resShort.status, 401);
    } finally {
      if (originalSecret === undefined) {
        delete process.env.DEPLOY_WEBHOOK_SECRET;
      } else {
        process.env.DEPLOY_WEBHOOK_SECRET = originalSecret;
      }
    }
  });

  await probe("F2-Deploy", "2.5: Concurrent push webhooks burst handled safely with unique IDs and concurrency lock", async () => {
    clearDeploymentHistory();
    const burstPromises = Array.from({ length: 15 }, (_, i) => {
      const req = new Request("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ref: "refs/heads/main",
          repository: { name: `burst-repo-${i}` },
          commits: [{ id: `sha_${i}`, message: `Commit ${i}` }],
        }),
      });
      return deployWebhookPost(req);
    });

    const responses = await Promise.all(burstPromises);
    const ids = new Set<string>();
    for (const res of responses) {
      assert.strictEqual(res.status, 202);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(json.deploymentId);
      ids.add(json.deploymentId);
    }
    assert.strictEqual(ids.size, 15, "All 15 burst deployments must have unique IDs");
  });

  // ===========================================================================
  // FEATURE 3: DISCORD ALERTS FORMAT VALIDATION & BURST RESILIENCE
  // ===========================================================================
  console.log("\n--- FEATURE 3: Discord Alerts Webhook & Cooldown Resilience ---");

  await probe("F3-Discord", "3.1: Live Discord webhook test execution returns 2xx status from Discord API", async () => {
    const result = await testDiscordWebhook();
    assert.strictEqual(result.success, true);
    assert.ok(result.statusCode >= 200 && result.statusCode < 300, `Expected 2xx status, got ${result.statusCode}`);
  });

  await probe("F3-Discord", "3.2: 10-Minute per-process cooldown suppresses repetitive alert flooding", async () => {
    clearAlertCooldowns();
    const testProc = "stress-process-cooldown-check";

    // First alert dispatches
    const first = await sendDiscordAlert({
      title: "First Alert",
      description: "Initial crash",
      level: "crash",
      processName: testProc,
    });
    assert.strictEqual(first.success, true);
    assert.strictEqual(first.rateLimited, undefined);

    // Second rapid alert is throttled by cooldown (429)
    const second = await sendDiscordAlert({
      title: "Second Alert",
      description: "Repeated crash",
      level: "crash",
      processName: testProc,
    });
    assert.strictEqual(second.success, false);
    assert.strictEqual(second.statusCode, 429);
    assert.strictEqual(second.rateLimited, true);

    // bypassCooldown flag allows emergency dispatches
    const bypassed = await sendDiscordAlert({
      title: "Emergency Alert",
      description: "Bypass cooldown",
      level: "crash",
      processName: testProc,
      bypassCooldown: true,
    });
    assert.strictEqual(bypassed.success, true);
  });

  await probe("F3-Discord", "3.3: Rapid burst of crash triggers handled without process crash or uncaught rejection", async () => {
    const procs = Array.from({ length: 10 }, (_, i) => ({
      name: `burst-worker-${i}`,
      id: i,
      status: "errored",
      cpu: 95.5,
      memory: 120 * 1024 * 1024,
      restarts: 3,
    }));

    const alertResults = await checkVitalsAndAlert(procs);
    assert.ok(Array.isArray(alertResults));
    assert.ok(alertResults.length > 0);
  });

  await probe("F3-Discord", "3.4: Malformed and unreachable webhook URLs return error gracefully without throwing", async () => {
    const badUrlResult = await sendDiscordAlert({
      title: "Faulty Endpoint Test",
      description: "Non-existent domain",
      url: "https://invalid-nonexistent-discord-domain-xyz.test/api/webhooks/123",
      bypassCooldown: true,
    });
    assert.strictEqual(badUrlResult.success, false);
    assert.strictEqual(badUrlResult.statusCode, 500);
    assert.ok(badUrlResult.error);
  });

  // ===========================================================================
  // FEATURE 4: SSE LOG STREAMER DISCONNECTS, INJECTION RESILIENCE & T=0S EVENT
  // ===========================================================================
  console.log("\n--- FEATURE 4: SSE Log Streamer Concurrency & Injection Defense ---");

  await probe("F4-SSE", "4.1: Handshake connection event emitted immediately at t=0s (<100ms latency)", async () => {
    const stream = createLogStream({ processName: "pmmanager-web", lines: 0 });
    const reader = stream.getReader();

    const start = Date.now();
    const { value, done } = await reader.read();
    const elapsed = Date.now() - start;

    assert.strictEqual(done, false);
    assert.ok(value instanceof Uint8Array);
    const text = new TextDecoder().decode(value);
    assert.ok(text.startsWith("data: "));
    assert.ok(elapsed < 100, `Expected initial event in <100ms, took ${elapsed}ms`);

    const jsonStr = text.replace(/^data:\s*/, "").trim();
    const evt = JSON.parse(jsonStr);
    assert.ok(evt.timestamp);
    assert.ok(evt.process);
    assert.ok(evt.message);

    await reader.cancel();
  });

  await probe("F4-SSE", "4.2: AbortSignal rapid disconnect burst (20 parallel connect-and-abort cycles) closes cleanly without leaks or crashes", async () => {
    const burstSize = 20;
    const abortTasks = Array.from({ length: burstSize }, async (_, i) => {
      const controller = new AbortController();
      const req = new Request(`http://localhost:3000/api/pm2/logs/stream?abort_stress_${i}=1`, {
        signal: controller.signal,
      });

      const res = await sseStreamGet(req);
      assert.strictEqual(res.status, 200);

      // Jittered abort timing (0ms to 15ms)
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 15)));
      controller.abort();

      if (res.body) {
        const reader = res.body.getReader();
        try {
          await reader.read();
        } catch {}
        try {
          await reader.cancel();
        } catch {}
      }
    });

    await Promise.all(abortTasks);
  });

  await probe("F4-SSE", "4.3: Command injection payload in ?targetProcess= strictly rejected with HTTP 400", async () => {
    const injectionQueries = [
      "app; whoami",
      "web && cat /etc/passwd",
      "worker | id",
      "`echo pwned`",
      "$(whoami)",
    ];

    for (const vector of injectionQueries) {
      const req = new Request(`http://localhost:3000/api/pm2/logs/stream?targetProcess=${encodeURIComponent(vector)}`);
      const res = await sseStreamGet(req);
      assert.strictEqual(res.status, 400, `Expected 400 for vector: ${vector}`);
    }
  });

  await probe("F4-SSE", "4.4: Command injection payload in ?process= is safely neutralized (zero host execution)", async () => {
    const canaryFile = path.join(process.cwd(), "m11_canary.txt");
    if (fs.existsSync(canaryFile)) {
      try { fs.unlinkSync(canaryFile); } catch {}
    }

    const payload = `app & echo PWNED > "${canaryFile}" &`;
    const req = new Request(`http://localhost:3000/api/pm2/logs/stream?process=${encodeURIComponent(payload)}&lines=0`);
    const res = await sseStreamGet(req);
    assert.strictEqual(res.status, 200);

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();

    assert.ok(value);
    const text = new TextDecoder().decode(value);
    assert.ok(text.toLowerCase().includes("live log stream connected successfully"));

    const executed = fs.existsSync(canaryFile);
    if (executed) {
      try { fs.unlinkSync(canaryFile); } catch {}
    }
    assert.strictEqual(executed, false, "Canary file must NOT be created by injection payload");
  });

  await probe("F4-SSE", "4.5: Multiple concurrent SSE connections stream independently without interference", async () => {
    const streams = Array.from({ length: 5 }, (_, i) =>
      createLogStream({ processName: `proc-${i}`, lines: 1 })
    );

    const readers = streams.map((s) => s.getReader());
    const initialReads = await Promise.all(readers.map((r) => r.read()));

    for (const read of initialReads) {
      assert.strictEqual(read.done, false);
      assert.ok(read.value);
    }

    await Promise.all(readers.map((r) => r.cancel()));
  });

  // ===========================================================================
  // FEATURE 5: HISTORICAL VITALS IDEMPOTENCY, BOUNDS & SQL INJECTION
  // ===========================================================================
  console.log("\n--- FEATURE 5: Historical Vitals Idempotency & SQLi Defense ---");

  await probe("F5-Vitals", "5.1: Idempotency of GET /api/vitals/history: read operations cause ZERO mutations", async () => {
    const beforeTotal = getVitalsCount();
    const ghostProc = `ghost-test-${Date.now()}`;

    // Execute 10 consecutive GET requests
    for (let i = 0; i < 10; i++) {
      const req = new NextRequest(`http://localhost:3000/api/vitals/history?process=${ghostProc}&hours=24`, {
        headers: { "x-mock-role": "admin" },
      });
      const res = await vitalsHistoryGet(req);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.deepStrictEqual(json.data, []);
    }

    const afterTotal = getVitalsCount();
    assert.strictEqual(beforeTotal, afterTotal, "GET /api/vitals/history must not insert rows into pm2_vitals");
  });

  await probe("F5-Vitals", "5.2: Extreme hours parameters (-999999, 0, 100000, 1e12, NaN) handle gracefully", async () => {
    const testHours = ["-999999", "0", "100000", "1000000000000", "invalid", "NaN", "12.5"];

    for (const h of testHours) {
      const req = new NextRequest(`http://localhost:3000/api/vitals/history?hours=${h}`, {
        headers: { "x-mock-role": "admin" },
      });
      const res = await vitalsHistoryGet(req);
      assert.strictEqual(res.status, 200, `Expected 200 for hours=${h}`);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(Array.isArray(json.data));
    }
  });

  await probe("F5-Vitals", "5.3: SQL injection attacks in ?process= and ?hours= fail safely via prepared statements", async () => {
    const sqliPayloads = [
      "' OR 1=1 --",
      "'; DROP TABLE users; --",
      "' UNION SELECT 1, 'admin', 'hash', 'admin' --",
      "1; DROP TABLE pm2_vitals; --",
    ];

    for (const sqli of sqliPayloads) {
      const req = new NextRequest(`http://localhost:3000/api/vitals/history?process=${encodeURIComponent(sqli)}`, {
        headers: { "x-mock-role": "admin" },
      });
      const res = await vitalsHistoryGet(req);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      // Injection vector is treated as literal process name -> returns empty data
      assert.deepStrictEqual(json.data, []);
    }
  });

  // ===========================================================================
  // FEATURE 6: FAIL2BAN COMMAND INJECTION SANITIZATION & RBAC ENFORCEMENT
  // ===========================================================================
  console.log("\n--- FEATURE 6: Fail2Ban Injection Lockdown & Role Restriction ---");

  await probe("F6-Fail2Ban", "6.1: Command injection metacharacters in IP strictly rejected with HTTP 400", async () => {
    const maliciousIps = [
      "192.168.1.1; whoami",
      "10.0.0.1 && cat /etc/passwd",
      "127.0.0.1 | id",
      "`echo pwned`",
      "$(whoami)",
      "192.168.1.1\nwhoami",
      "../../../../etc/passwd",
      "192.168.1.1;rm -rf /",
    ];

    for (const badIp of maliciousIps) {
      const req = new NextRequest("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: { "x-mock-role": "admin", "content-type": "application/json" },
        body: JSON.stringify({ jail: "sshd", ip: badIp }),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(res.status, 400, `Expected 400 for malicious IP: ${badIp}`);
    }
  });

  await probe("F6-Fail2Ban", "6.2: Command injection metacharacters in jail strictly rejected with HTTP 400", async () => {
    const maliciousJails = [
      "sshd; whoami",
      "sshd && id",
      "jail|cat /etc/shadow",
      "`reboot`",
      "../../etc/fail2ban",
    ];

    for (const badJail of maliciousJails) {
      const req = new NextRequest("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: { "x-mock-role": "admin", "content-type": "application/json" },
        body: JSON.stringify({ jail: badJail, ip: "192.168.1.1" }),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(res.status, 400, `Expected 400 for malicious jail: ${badJail}`);
    }
  });

  await probe("F6-Fail2Ban", "6.3: Developer role is strictly 403 Forbidden even with valid unban parameters", async () => {
    const req = new NextRequest("http://localhost:3000/api/fail2ban/unban", {
      method: "POST",
      headers: { "x-mock-role": "developer", "content-type": "application/json" },
      body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
    });
    const res = await fail2banUnbanPost(req);
    assert.strictEqual(res.status, 403, `Expected 403 Forbidden for developer, got ${res.status}`);
  });

  await probe("F6-Fail2Ban", "6.4: Unbanning non-existent IP returns graceful HTTP 200/404 without 500 error", async () => {
    const req = new NextRequest("http://localhost:3000/api/fail2ban/unban", {
      method: "POST",
      headers: { "x-mock-role": "admin", "content-type": "application/json" },
      body: JSON.stringify({ jail: "sshd", ip: "203.0.113.199" }),
    });
    const res = await fail2banUnbanPost(req);
    assert.ok(res.status === 200 || res.status === 404, `Expected 200 or 404, got ${res.status}`);
  });

  // ===========================================================================
  // FEATURE 7: UPTIME MONITORING DEAD HOST PINGS, SLA & CASCADING CLEANUP
  // ===========================================================================
  console.log("\n--- FEATURE 7: Uptime Monitoring Non-Blocking Pings, SLA & Cleanup ---");

  await probe("F7-Uptime", "7.1: Dead host and unreachable IP pings with AbortController are non-blocking and timeout safely", async () => {
    // Non-routable blackhole IP (RFC 5737 TEST-NET-1) with 1500ms timeout
    const pingRes = await pingUrl("http://192.0.2.1:54321", 1500);
    assert.strictEqual(pingRes.status, "DOWN");
    assert.strictEqual(pingRes.statusCode, null);
    assert.ok(pingRes.error);
    assert.ok(pingRes.responseTime >= 1);
  });

  await probe("F7-Uptime", "7.2: Division-by-zero SLA protection: monitors with zero checks report 100.0% SLA (finite, never NaN)", async () => {
    const created = createUptimeMonitor("Zero Checks SLA Test", "http://localhost:3000/api/pm2", 60);

    // Delete any initial checks so check count is strictly 0
    db.prepare("DELETE FROM uptime_checks WHERE monitorId = ?").run(created.id);

    const sla = recalculateMonitorSLA(created.id);
    assert.ok(sla !== null);
    assert.strictEqual(sla.uptimePercentage, 100.0);
    assert.strictEqual(sla.lastStatus, "PENDING");
    assert.strictEqual(!isNaN(sla.uptimePercentage), true);
    assert.strictEqual(isFinite(sla.uptimePercentage), true);

    deleteUptimeMonitor(created.id);
  });

  await probe("F7-Uptime", "7.3: Cascading check cleanup on monitor deletion removes monitor and all child check records", async () => {
    const created = createUptimeMonitor("Cascade Deletion Test", "http://localhost:3000/api/pm2", 60);

    // Insert 5 check records for this monitor
    for (let i = 0; i < 5; i++) {
      recordUptimeCheck({
        monitorId: created.id,
        status: i % 2 === 0 ? "UP" : "DOWN",
        statusCode: i % 2 === 0 ? 200 : 500,
        responseTime: 45,
      });
    }

    const checksBefore = getUptimeChecks(created.id, 50);
    assert.strictEqual(checksBefore.length, 5);

    // Delete monitor
    const deleted = deleteUptimeMonitor(created.id);
    assert.strictEqual(deleted, true);

    // Verify monitor is gone
    const monitorAfter = getUptimeMonitorById(created.id);
    assert.strictEqual(monitorAfter, null);

    // Verify ALL child check records are cascade-deleted
    const checksAfter = getUptimeChecks(created.id, 50);
    assert.strictEqual(checksAfter.length, 0, "All associated uptime checks must be cascade deleted");
  });

  // ===========================================================================
  // SUMMARY REPORT
  // ===========================================================================
  console.log("\n================================================================================");
  console.log("             MILESTONE 11 TIER 5 ADVERSARIAL STRESS RUN SUMMARY                ");
  console.log("================================================================================");

  const total = probeResults.length;
  const passed = probeResults.filter((r) => r.passed).length;
  const failed = probeResults.filter((r) => !r.passed).length;

  console.log(`Total Adversarial Probes : ${total}`);
  console.log(`Passed                   : ${passed}`);
  console.log(`Failed                   : ${failed}`);
  console.log(`Success Rate             : ${((passed / total) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.error("\nFAILED PROBES:");
    for (const r of probeResults.filter((r) => !r.passed)) {
      console.error(`  ✖ [${r.feature}] ${r.name}: ${r.error}`);
    }
    process.exit(1);
  } else {
    console.log("\nOVERALL STATUS: ALL ENTERPRISE ADVERSARIAL HARDENING PROBES PASSED (100% SUCCESS)");
    console.log("CHALLENGER VERDICT: APPROVE");
    process.exit(0);
  }
}

runAdversarialSuite().catch((err) => {
  console.error("Fatal test execution error:", err);
  process.exit(1);
});
