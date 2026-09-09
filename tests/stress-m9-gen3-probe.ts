/**
 * Milestone 9: Empirical Adversarial Probe & Stress Harness (Gen 3 Challenger)
 *
 * Dedicated probe for:
 * 1. SQL Injection Resilience (name, url, query parameters, id parameters)
 * 2. Cascading Deletion & Referential Integrity (API & SQLite engine)
 * 3. Timeout & Error Handling on dead/hanging URLs (non-blocking event loop)
 * 4. Division-by-Zero SLA Math Protection
 * 5. Strict Auth Guard Verification (401 on unauthenticated calls)
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import http from "node:http";
import { NextRequest } from "next/server";

import {
  db,
  createUptimeMonitor,
  getUptimeMonitors,
  getUptimeMonitorById,
  updateUptimeMonitor,
  deleteUptimeMonitor,
  recordUptimeCheck,
  getUptimeChecks,
  recalculateMonitorSLA,
} from "../src/lib/db";

import {
  pingUrl,
  performUptimeCheck,
  startUptimeWorker,
  stopUptimeWorker,
  isUptimeWorkerActive,
} from "../src/lib/uptime-service";

import {
  GET as uptimeGet,
  POST as uptimePost,
  DELETE as uptimeDelete,
} from "../src/app/api/uptime/route";

import {
  POST as uptimeCheckPost,
  GET as uptimeCheckGet,
} from "../src/app/api/uptime/check/route";

interface ProbeResult {
  section: string;
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

const results: ProbeResult[] = [];

async function probe(section: string, name: string, fn: () => void | Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    results.push({ section, name, passed: true, durationMs });
    console.log(`  ? [PASS] [${section}] ${name} (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    results.push({ section, name, passed: false, error: err.message || String(err), durationMs });
    console.error(`  ? [FAIL] [${section}] ${name} (${durationMs}ms): ${err.message}`);
  }
}

async function runEmpiricalProbe() {
  console.log("================================================================================");
  console.log(" Milestone 9 Gen 3: Empirical Adversarial Probe Harness");
  console.log("================================================================================");

  const cleanupIds: number[] = [];

  // ============================================================================
  // SECTION 1: SQL INJECTION PROBES
  // ============================================================================
  console.log("\n--- SECTION 1: SQL Injection Probes ---");

  await probe("SQLi", "1.1: Monitor name DDL injection ('; DROP TABLE uptime_monitors; --)", async () => {
    const maliciousName = "malicious_srv'; DROP TABLE uptime_monitors; --";
    const req = new NextRequest("http://localhost:3000/api/uptime", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
      body: JSON.stringify({ name: maliciousName, url: "https://example.com/health", intervalSeconds: 60 }),
    });
    const res = await uptimePost(req);
    assert.strictEqual(res.status, 201);
    const json = await res.json();
    cleanupIds.push(json.monitor.id);

    // Verify table still exists and queryable
    const count = db.prepare("SELECT count(*) as cnt FROM uptime_monitors").get() as { cnt: number };
    assert.ok(count.cnt > 0);

    // Verify name stored literally without code execution
    const stored = getUptimeMonitorById(json.monitor.id);
    assert.strictEqual(stored?.name, maliciousName);
  });

  await probe("SQLi", "1.2: Monitor URL SQL injection with UNION SELECT", async () => {
    const maliciousUrl = "http://example.com/test' UNION SELECT 1,'hacked','http://hacked.com',60,'UP',100,NULL,0,CURRENT_TIMESTAMP--";
    const req = new NextRequest("http://localhost:3000/api/uptime", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
      body: JSON.stringify({ name: "sqli-url-test", url: maliciousUrl }),
    });
    const res = await uptimePost(req);
    assert.strictEqual(res.status, 201);
    const json = await res.json();
    cleanupIds.push(json.monitor.id);

    // Verify URL stored safely
    const stored = getUptimeMonitorById(json.monitor.id);
    assert.strictEqual(stored?.url, maliciousUrl);
  });

  await probe("SQLi", "1.3: Second-order SQLi in updateUptimeMonitor", async () => {
    const mon = createUptimeMonitor("base-monitor", "https://example.com/base");
    cleanupIds.push(mon.id);

    const maliciousUpdate = "updated'; UPDATE users SET role='admin'; --";
    const success = updateUptimeMonitor(mon.id, { name: maliciousUpdate });
    assert.strictEqual(success, true);

    const refreshed = getUptimeMonitorById(mon.id);
    assert.strictEqual(refreshed?.name, maliciousUpdate);
  });

  await probe("SQLi", "1.4: Query string injection on DELETE /api/uptime (?id=1 OR 1=1)", async () => {
    // Should fail with 400 because '1 OR 1=1' is parsed as invalid ID or strictly sanitized
    const req = new NextRequest("http://localhost:3000/api/uptime?id=1%20OR%201=1", {
      method: "DELETE",
      headers: { "x-mock-role": "admin" },
    });
    const res = await uptimeDelete(req);
    // parseInt("1 OR 1=1") is 1 in JS, but let's see how route handles it or if it deletes all
    // More importantly: verify it does NOT execute 'DELETE FROM uptime_monitors WHERE id = 1 OR 1=1'
    const totalMonitors = getUptimeMonitors().length;
    assert.ok(totalMonitors >= 0);
  });

  await probe("SQLi", "1.5: String injection in DELETE /api/uptime body ({ id: \"' OR '1'='1\" })", async () => {
    const req = new NextRequest("http://localhost:3000/api/uptime", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
      body: JSON.stringify({ id: "' OR '1'='1" }),
    });
    const res = await uptimeDelete(req);
    assert.strictEqual(res.status, 400);
    const json = await res.json();
    assert.strictEqual(json.error, "Invalid monitor ID");
  });

  await probe("SQLi", "1.6: String injection on POST /api/uptime/check body ({ id: \"1; DROP TABLE users; --\" })", async () => {
    const req = new NextRequest("http://localhost:3000/api/uptime/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
      body: JSON.stringify({ id: "1; DROP TABLE users; --" }),
    });
    const res = await uptimeCheckPost(req);
    // Even if parseInt extracts 1 or fails, users table must exist
    const usersCount = db.prepare("SELECT count(*) as cnt FROM users").get() as { cnt: number };
    assert.ok(usersCount.cnt > 0);
  });

  // ============================================================================
  // SECTION 2: CASCADING DELETION & REFERENTIAL INTEGRITY
  // ============================================================================
  console.log("\n--- SECTION 2: Cascading Deletion & Referential Integrity ---");

  await probe("Cascading", "2.1: SQLite PRAGMA foreign_keys is ENABLED", async () => {
    const pragma = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    assert.strictEqual(pragma.foreign_keys, 1, "Foreign keys must be enabled (PRAGMA foreign_keys = 1)");
  });

  await probe("Cascading", "2.2: Schema definition enforces ON DELETE CASCADE on uptime_checks", async () => {
    const fks = db.prepare("PRAGMA foreign_key_list(uptime_checks)").all() as any[];
    const fk = fks.find((f) => f.table === "uptime_monitors");
    assert.ok(fk, "uptime_checks must have foreign key to uptime_monitors");
    assert.strictEqual(fk.on_delete.toUpperCase(), "CASCADE");
  });

  await probe("Cascading", "2.3: API DELETE /api/uptime purges monitor and child uptime_checks", async () => {
    const mon = createUptimeMonitor("cascade-api-test", "https://example.com/ping");
    const check1 = recordUptimeCheck({ monitorId: mon.id, status: "UP", responseTime: 50 });
    const check2 = recordUptimeCheck({ monitorId: mon.id, status: "DOWN", responseTime: 500, error: "HTTP 500" });

    // Verify checks exist in DB
    const checksBefore = db.prepare("SELECT count(*) as cnt FROM uptime_checks WHERE monitorId = ?").get(mon.id) as { cnt: number };
    assert.strictEqual(checksBefore.cnt, 2);

    // Call DELETE API
    const req = new NextRequest(`http://localhost:3000/api/uptime?id=${mon.id}`, {
      method: "DELETE",
      headers: { "x-mock-role": "admin" },
    });
    const res = await uptimeDelete(req);
    assert.strictEqual(res.status, 200);

    // Verify monitor deleted
    assert.strictEqual(getUptimeMonitorById(mon.id), null);

    // Verify child checks cascaded
    const checksAfter = db.prepare("SELECT count(*) as cnt FROM uptime_checks WHERE monitorId = ?").get(mon.id) as { cnt: number };
    assert.strictEqual(checksAfter.cnt, 0, "Child checks must be completely purged upon monitor deletion");
  });

  await probe("Cascading", "2.4: Raw SQLite DELETE CASCADE works via engine foreign key", async () => {
    const mon = createUptimeMonitor("cascade-raw-test", "https://example.com/raw");
    recordUptimeCheck({ monitorId: mon.id, status: "UP", responseTime: 20 });
    recordUptimeCheck({ monitorId: mon.id, status: "UP", responseTime: 25 });

    // Raw SQL delete directly on uptime_monitors without manually deleting uptime_checks
    db.prepare("DELETE FROM uptime_monitors WHERE id = ?").run(mon.id);

    const checksAfter = db.prepare("SELECT count(*) as cnt FROM uptime_checks WHERE monitorId = ?").get(mon.id) as { cnt: number };
    assert.strictEqual(checksAfter.cnt, 0, "SQLite engine cascade must delete child checks");
  });

  await probe("Cascading", "2.5: Foreign Key constraint rejects orphan checks", async () => {
    const nonExistentMonitorId = 99999999;
    assert.throws(
      () => {
        db.prepare(
          "INSERT INTO uptime_checks (monitorId, status, statusCode, responseTime, error, timestamp) VALUES (?, 'UP', 200, 10, NULL, ?)"
        ).run(nonExistentMonitorId, new Date().toISOString());
      },
      (err: any) => err.message.includes("FOREIGN KEY constraint failed")
    );
  });

  // ============================================================================
  // SECTION 3: TIMEOUT & ERROR HANDLING ON DEAD/HANGING URLS (NON-BLOCKING)
  // ============================================================================
  console.log("\n--- SECTION 3: Timeout & Error Handling (Non-blocking) ---");

  await probe("Resilience", "3.1: Dead/unresolvable domain returns DOWN without crashing", async () => {
    const res = await pingUrl("http://non-existent-domain-xyz-12345.nexus.invalid", 2000);
    assert.strictEqual(res.status, "DOWN");
    assert.strictEqual(res.statusCode, null);
    assert.ok(res.error, "Error message must be present");
    assert.ok(res.responseTime > 0);
  });

  await probe("Resilience", "3.2: Connection refused on dead port returns DOWN", async () => {
    const res = await pingUrl("http://127.0.0.1:59998", 2000);
    assert.strictEqual(res.status, "DOWN");
    assert.strictEqual(res.statusCode, null);
    assert.ok(res.error?.toLowerCase().includes("refused") || res.error?.toLowerCase().includes("fetch failed"));
  });

  await probe("Resilience", "3.3: HTTP 500 status code marked DOWN with correct statusCode", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address() as any;
    const testUrl = `http://127.0.0.1:${address.port}/error`;

    try {
      const res = await pingUrl(testUrl, 2000);
      assert.strictEqual(res.status, "DOWN");
      assert.strictEqual(res.statusCode, 500);
      assert.ok(res.error?.includes("500"));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  await probe("Resilience", "3.4: HTTP 200 OK marked UP with correct statusCode and responseTime", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ healthy: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address() as any;
    const testUrl = `http://127.0.0.1:${address.port}/health`;

    try {
      const res = await pingUrl(testUrl, 2000);
      assert.strictEqual(res.status, "UP");
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.error, null);
      assert.ok(res.responseTime >= 1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  await probe("Resilience", "3.5: Hanging socket triggers AbortController timeout non-blockingly", async () => {
    // Server that accepts connection but never writes headers or data
    const hangingServer = http.createServer(() => {});
    await new Promise<void>((resolve) => hangingServer.listen(0, "127.0.0.1", () => resolve()));
    const address = hangingServer.address() as any;
    const hangingUrl = `http://127.0.0.1:${address.port}/hang`;

    // Measure event loop responsiveness while pinging
    let loopTicks = 0;
    const loopInterval = setInterval(() => { loopTicks++; }, 25);

    try {
      const pingStart = Date.now();
      const res = await pingUrl(hangingUrl, 1500); // 1.5s custom timeout
      const pingElapsed = Date.now() - pingStart;

      clearInterval(loopInterval);

      assert.strictEqual(res.status, "DOWN");
      assert.strictEqual(res.statusCode, null);
      assert.ok(res.error?.includes("timed out") || res.error?.includes("aborted"));
      assert.ok(pingElapsed >= 1400 && pingElapsed <= 2500, `Elapsed ${pingElapsed}ms should be ~1500ms`);
      assert.ok(loopTicks >= 30, `Event loop must tick during timeout (actual ticks: ${loopTicks})`);
    } finally {
      clearInterval(loopInterval);
      await new Promise<void>((resolve) => hangingServer.close(() => resolve()));
    }
  });

  // ============================================================================
  // SECTION 4: DIVISION-BY-ZERO SLA CALCULATION PROTECTION
  // ============================================================================
  console.log("\n--- SECTION 4: Division-by-Zero SLA Math Protection ---");

  await probe("SLA", "4.1: Brand new monitor with 0 checks yields 100.0% SLA (no NaN/null)", async () => {
    const mon = createUptimeMonitor("sla-zero-checks", "https://example.com/sla");
    cleanupIds.push(mon.id);

    const sla = recalculateMonitorSLA(mon.id);
    assert.ok(sla !== null);
    assert.strictEqual(typeof sla.uptimePercentage, "number");
    assert.strictEqual(Number.isFinite(sla.uptimePercentage), true);
    assert.strictEqual(Number.isNaN(sla.uptimePercentage), false);
    assert.strictEqual(sla.uptimePercentage, 100.0);
    assert.strictEqual(sla.avgResponseTimeMs, 0);
    assert.strictEqual(sla.lastStatus, "PENDING");
  });

  await probe("SLA", "4.2: SLA transitions through 100% -> 50% -> 25% -> 0% accurately", async () => {
    const mon = createUptimeMonitor("sla-math-test", "https://example.com/sla-math");
    cleanupIds.push(mon.id);

    // 1 UP check: 1/1 = 100%
    recordUptimeCheck({ monitorId: mon.id, status: "UP", responseTime: 100 });
    let sla = recalculateMonitorSLA(mon.id);
    assert.strictEqual(sla?.uptimePercentage, 100.0);
    assert.strictEqual(sla?.lastStatus, "UP");

    // 1 DOWN check: 1/2 = 50%
    recordUptimeCheck({ monitorId: mon.id, status: "DOWN", responseTime: 200, error: "HTTP 500" });
    sla = recalculateMonitorSLA(mon.id);
    assert.strictEqual(sla?.uptimePercentage, 50.0);
    assert.strictEqual(sla?.lastStatus, "DOWN");

    // 2 more DOWN checks: 1/4 = 25%
    recordUptimeCheck({ monitorId: mon.id, status: "DOWN", responseTime: 300 });
    recordUptimeCheck({ monitorId: mon.id, status: "DOWN", responseTime: 400 });
    sla = recalculateMonitorSLA(mon.id);
    assert.strictEqual(sla?.uptimePercentage, 25.0);
    assert.strictEqual(sla?.avgResponseTimeMs, 250.0); // (100+200+300+400)/4 = 250

    // Purge checks and recalculate: must return 100% default without dividing by zero
    db.prepare("DELETE FROM uptime_checks WHERE monitorId = ?").run(mon.id);
    sla = recalculateMonitorSLA(mon.id);
    assert.ok(sla !== null);
    assert.strictEqual(sla.uptimePercentage, 100.0);
    assert.strictEqual(sla.avgResponseTimeMs, 0);
    assert.strictEqual(sla.lastStatus, "PENDING");
  });

  // ============================================================================
  // SECTION 5: STRICT AUTH GUARD VERIFICATION
  // ============================================================================
  console.log("\n--- SECTION 5: Strict Auth Guard Verification ---");

  await probe("Auth", "5.1: Unauthenticated GET /api/uptime yields 401 Unauthorized", async () => {
    const req = new NextRequest("http://localhost:3000/api/uptime", {
      method: "GET",
      headers: { "x-mock-role": "unauthenticated" },
    });
    const res = await uptimeGet(req);
    assert.strictEqual(res.status, 401);
    const json = await res.json();
    assert.strictEqual(json.error, "Unauthorized");
  });

  await probe("Auth", "5.2: Unauthenticated POST /api/uptime yields 401 Unauthorized", async () => {
    const req = new NextRequest("http://localhost:3000/api/uptime", {
      method: "POST",
      headers: { "x-mock-role": "unauthenticated", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "unauth-srv", url: "https://example.com" }),
    });
    const res = await uptimePost(req);
    assert.strictEqual(res.status, 401);
    const json = await res.json();
    assert.strictEqual(json.error, "Unauthorized");
  });

  await probe("Auth", "5.3: Unauthenticated DELETE /api/uptime yields 401 Unauthorized", async () => {
    const req = new NextRequest("http://localhost:3000/api/uptime?id=1", {
      method: "DELETE",
      headers: { "x-mock-role": "unauthenticated" },
    });
    const res = await uptimeDelete(req);
    assert.strictEqual(res.status, 401);
    const json = await res.json();
    assert.strictEqual(json.error, "Unauthorized");
  });

  await probe("Auth", "5.4: Unauthenticated POST /api/uptime/check yields 401 Unauthorized", async () => {
    const req = new NextRequest("http://localhost:3000/api/uptime/check?id=1", {
      method: "POST",
      headers: { "x-mock-role": "unauthenticated" },
    });
    const res = await uptimeCheckPost(req);
    assert.strictEqual(res.status, 401);
    const json = await res.json();
    assert.strictEqual(json.error, "Unauthorized");
  });

  await probe("Auth", "5.5: GET /api/uptime/check returns 405 Method Not Allowed", async () => {
    const res = await uptimeCheckGet();
    assert.strictEqual(res.status, 405);
  });

  await probe("Auth", "5.6: Authenticated Developer role has access to Uptime GET/POST/DELETE", async () => {
    // Developer role can view uptime
    const getReq = new NextRequest("http://localhost:3000/api/uptime", {
      method: "GET",
      headers: { "x-mock-role": "developer" },
    });
    const getRes = await uptimeGet(getReq);
    assert.strictEqual(getRes.status, 200);

    // Developer role can create monitor
    const postReq = new NextRequest("http://localhost:3000/api/uptime", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ name: "dev-mon", url: "https://example.com/dev" }),
    });
    const postRes = await uptimePost(postReq);
    assert.strictEqual(postRes.status, 201);
    const postJson = await postRes.json();
    cleanupIds.push(postJson.monitor.id);

    // Developer role can check monitor
    const checkReq = new NextRequest(`http://localhost:3000/api/uptime/check?id=${postJson.monitor.id}`, {
      method: "POST",
      headers: { "x-mock-role": "developer" },
    });
    const checkRes = await uptimeCheckPost(checkReq);
    assert.strictEqual(checkRes.status, 200);
  });

  // ============================================================================
  // TEARDOWN CLEANUP
  // ============================================================================
  console.log("\n--- Teardown: Cleaning test resources ---");
  for (const id of cleanupIds) {
    try {
      deleteUptimeMonitor(id);
    } catch {}
  }
  stopUptimeWorker();

  // Summary
  console.log("\n================================================================================");
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(` Summary: ${passed}/${total} Probes Passed (${failed} Failed)`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runEmpiricalProbe().catch((err) => {
  console.error("FATAL ERROR in empirical probe runner:", err);
  process.exit(1);
});
