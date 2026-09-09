/**
 * Milestone 9: Adversarial Stress & Empirical Challenge Suite (Challenger 2)
 *
 * This test harness adversarially probes:
 * 1. SQL Injection Resilience:
 *    - Query parameter injection in ?process= and ?hours= on GET /api/vitals/history
 *    - Monitor creation injection in name and url on POST /api/uptime
 *    - Second-order update injection in updateUptimeMonitor
 *    - Boundary and type-casting attacks on DELETE /api/uptime and POST /api/uptime/check
 *    - Parameterized query verification in SQLite helper functions
 * 2. Foreign Key Cascading Deletion & Referential Integrity:
 *    - SQLite PRAGMA foreign_keys enablement verification
 *    - Schema ON DELETE CASCADE constraint verification
 *    - API-level deletion cascades all child uptime_checks automatically
 *    - SQLite engine-level raw SQL deletion cascades all child uptime_checks
 *    - Foreign key constraint rejection on orphan uptime_checks insertion
 *    - Bulk lifecycle monitor deletion stress
 * 3. Long-Running Ping Endurance & Event Loop Non-Blocking Verification:
 *    - 10s AbortController timeout verification on non-responsive HTTP server
 *    - High-frequency event loop lag measurement during 10s ping (verifies no event loop starvation)
 *    - High-concurrency hanging ping endurance (simultaneous aborted sockets)
 *    - performUptimeCheck and SLA calculation handling under hanging network conditions
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import http from "node:http";
import net from "node:net";
import { NextRequest } from "next/server";

// Import DB and helpers
import {
  db,
  recordVital,
  getVitalsHistory,
  getVitalsCount,
  createUptimeMonitor,
  getUptimeMonitors,
  getUptimeMonitorById,
  updateUptimeMonitor,
  deleteUptimeMonitor,
  recordUptimeCheck,
  getUptimeChecks,
  recalculateMonitorSLA,
} from "../src/lib/db";

// Import Uptime Service
import {
  pingUrl,
  performUptimeCheck,
  startUptimeWorker,
  stopUptimeWorker,
  isUptimeWorkerActive,
} from "../src/lib/uptime-service";

// Import Vitals Worker
import {
  startVitalsWorker,
  stopVitalsWorker,
  isVitalsWorkerActive,
  collectVitalsNow,
} from "../src/lib/vitals-worker";

// Import Route Handlers
import {
  GET as vitalsHistoryGet,
  POST as vitalsHistoryPost,
} from "../src/app/api/vitals/history/route";

import {
  GET as uptimeGet,
  POST as uptimePost,
  DELETE as uptimeDelete,
} from "../src/app/api/uptime/route";

import {
  POST as uptimeCheckPost,
  GET as uptimeCheckGet,
} from "../src/app/api/uptime/check/route";

interface TestStats {
  passed: number;
  failed: number;
  total: number;
}

const stats: TestStats = {
  passed: 0,
  failed: 0,
  total: 0,
};

async function test(name: string, fn: () => void | Promise<void>) {
  stats.total++;
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    console.log(`  ✓ [PASS] ${name} (${duration}ms)`);
    stats.passed++;
  } catch (err: any) {
    const duration = Date.now() - start;
    stats.failed++;
    console.error(`  ✗ [FAIL] ${name} (${duration}ms)`);
    console.error(`    Details: ${err.message}`);
    if (err.stack) {
      console.error(`    ${err.stack.split("\n").slice(1, 4).join("\n    ")}`);
    }
  }
}

function makeAuthRequest(
  url: string,
  method: string = "GET",
  body?: any,
  role: string = "admin"
): NextRequest {
  const headers: Record<string, string> = {
    "x-mock-role": role,
  };
  if (body) {
    headers["content-type"] = "application/json";
  }
  return new NextRequest(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ----------------------------------------------------------------------------
// Mock HTTP Servers for Testing
// ----------------------------------------------------------------------------

// 1. Fast server (responds 200 OK immediately)
let fastServer: http.Server;
let fastServerPort: number;
let fastServerUrl: string;

// 2. Hanging server (accepts connections, holds them open indefinitely, never responds)
let hangingServer: http.Server;
let hangingServerPort: number;
let hangingServerUrl: string;
const hangingSockets: Set<net.Socket> = new Set();

async function startMockServers(): Promise<void> {
  // Setup fast server
  await new Promise<void>((resolve) => {
    fastServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", timestamp: Date.now() }));
    });
    fastServer.listen(0, "127.0.0.1", () => {
      const addr = fastServer.address() as net.AddressInfo;
      fastServerPort = addr.port;
      fastServerUrl = `http://127.0.0.1:${fastServerPort}`;
      resolve();
    });
  });

  // Setup hanging server
  await new Promise<void>((resolve) => {
    hangingServer = http.createServer((req, res) => {
      // Deliberately do NOT respond, keep socket alive
    });
    hangingServer.on("connection", (socket) => {
      hangingSockets.add(socket);
      socket.on("close", () => hangingSockets.delete(socket));
    });
    hangingServer.listen(0, "127.0.0.1", () => {
      const addr = hangingServer.address() as net.AddressInfo;
      hangingServerPort = addr.port;
      hangingServerUrl = `http://127.0.0.1:${hangingServerPort}`;
      resolve();
    });
  });
}

async function stopMockServers(): Promise<void> {
  for (const socket of hangingSockets) {
    socket.destroy();
  }
  hangingSockets.clear();

  if (hangingServer) {
    await new Promise<void>((resolve) => hangingServer.close(() => resolve()));
  }
  if (fastServer) {
    await new Promise<void>((resolve) => fastServer.close(() => resolve()));
  }
}

// ----------------------------------------------------------------------------
// Main Stress & Challenge Runner
// ----------------------------------------------------------------------------

async function runAdversarialProbes() {
  console.log("================================================================================");
  console.log(" Milestone 9: Adversarial Challenge Suite (Challenger 2) ");
  console.log(" Probing SQL Injection, Cascading Lifecycle, and Ping Endurance Bounds ");
  console.log("================================================================================\n");

  await startMockServers();

  try {
    // ========================================================================
    // SECTION 1: SQL Injection Attacks on /api/vitals/history
    // ========================================================================
    console.log("--- Section 1: SQL Injection Probes on /api/vitals/history ---");

    // Seed identifiable canary vitals for distinct processes
    const now = Date.now();
    recordVital("canary-proc-alpha", 12.5, 50000000, new Date(now - 100000).toISOString());
    recordVital("canary-proc-beta", 34.2, 80000000, new Date(now - 80000).toISOString());
    recordVital("canary-proc-gamma", 5.1, 30000000, new Date(now - 50000).toISOString());

    await test("SQLi 1.1: Boolean bypass query in ?process=' OR '1'='1 does not leak other processes", async () => {
      const req = makeAuthRequest(
        "http://localhost:3000/api/vitals/history?process=' OR '1'='1&hours=24"
      );
      const res = await vitalsHistoryGet(req);
      assert.strictEqual(res.status, 200, "Should return HTTP 200");
      const json = await res.json();
      assert.strictEqual(json.success, true);

      // Verify that NO canary processes were leaked
      const leakedCanaries = json.data.filter(
        (d: any) =>
          d.process === "canary-proc-alpha" ||
          d.process === "canary-proc-beta" ||
          d.process === "canary-proc-gamma"
      );
      assert.strictEqual(
        leakedCanaries.length,
        0,
        "SQL injection attempt must not dump vitals from other process names"
      );

      // Verify returned items only match the exact literal string queried
      for (const d of json.data) {
        assert.strictEqual(
          d.process,
          "' OR '1'='1",
          "Every returned vital must match the exact literal queried process"
        );
      }
    });

    await test("SQLi 1.2: Destructive DDL injection in ?process='; DROP TABLE pm2_vitals; -- does not drop table", async () => {
      const req = makeAuthRequest(
        "http://localhost:3000/api/vitals/history?process='; DROP TABLE pm2_vitals; --&hours=24"
      );
      const res = await vitalsHistoryGet(req);
      assert.strictEqual(res.status, 200);

      // Check SQLite master table directly to verify pm2_vitals still exists
      const tableCheck = db
        .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='pm2_vitals'")
        .get() as { cnt: number };
      assert.strictEqual(tableCheck.cnt, 1, "pm2_vitals table must NOT be dropped by SQL injection attempt");

      // Verify canary vitals are still accessible
      const canaryCount = db
        .prepare("SELECT count(*) as cnt FROM pm2_vitals WHERE process LIKE 'canary-%'")
        .get() as { cnt: number };
      assert.ok(canaryCount.cnt >= 3, "Canary records must remain intact in pm2_vitals");
    });

    await test("SQLi 1.3: UNION SELECT injection in ?process= cannot exfiltrate user credentials", async () => {
      const unionPayload = "' UNION SELECT id, username, passwordHash, role, createdAt FROM users; --";
      const encoded = encodeURIComponent(unionPayload);
      const req = makeAuthRequest(
        `http://localhost:3000/api/vitals/history?process=${encoded}&hours=24`
      );
      const res = await vitalsHistoryGet(req);
      assert.strictEqual(res.status, 200);
      const json = await res.json();

      // Check that none of the returned rows contain user password hashes
      for (const item of json.data) {
        assert.ok(typeof item.cpu === "number", "cpu must remain numeric");
        assert.ok(typeof item.memory === "number", "memory must remain numeric");
        assert.ok(!item.passwordHash, "Password hash must not be present in response");
        assert.ok(
          !item.cpu.toString().includes("$2b$") && !item.cpu.toString().includes("$2a$"),
          "Bcrypt hash must not be cast into cpu field"
        );
      }
    });

    await test("SQLi 1.4: Multi-statement and boundary attacks in ?hours= parameter", async () => {
      const attackVectors = [
        "24; DROP TABLE pm2_vitals; --",
        "24' OR '1'='1",
        "' OR 1=1 --",
        "-50",
        "0",
        "999999999999999999999999999999999999999",
        "NaN",
        "Infinity",
        "1e10",
        "null",
        "undefined",
        "'; SELECT sqlite_version(); --",
      ];

      for (const vector of attackVectors) {
        const req = makeAuthRequest(
          `http://localhost:3000/api/vitals/history?process=canary-proc-alpha&hours=${encodeURIComponent(
            vector
          )}`
        );
        const res = await vitalsHistoryGet(req);
        assert.strictEqual(
          res.status,
          200,
          `API must gracefully handle invalid hours vector without crashing: ${vector}`
        );
        const json = await res.json();
        assert.strictEqual(json.success, true);
        assert.ok(Array.isArray(json.data));
      }

      // Verify pm2_vitals table still exists and is healthy
      const count = getVitalsCount();
      assert.ok(count > 0, "pm2_vitals must still have rows");
    });

    await test("SQLi 1.5: Direct SQLite Helper parameterization on getVitalsHistory and recordVital", () => {
      // 1. Calling getVitalsHistory with malicious process strings
      const evilProc = "'; DROP TABLE users; --";
      const result = getVitalsHistory(evilProc, 24);
      assert.ok(Array.isArray(result));

      // Verify users table was NOT dropped
      const userCheck = db
        .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='users'")
        .get() as { cnt: number };
      assert.strictEqual(userCheck.cnt, 1, "users table must not be dropped");

      // 2. Calling recordVital with injection payload in process name
      const injectedVital = recordVital("'; DELETE FROM pm2_vitals; --", 5.5, 45000000);
      assert.strictEqual(
        injectedVital.process,
        "'; DELETE FROM pm2_vitals; --",
        "Process name should be recorded literally"
      );

      // Verify table was NOT cleared
      const countAfter = getVitalsCount();
      assert.ok(countAfter >= 4, "pm2_vitals rows must not be deleted");

      // 3. getVitalsCount with injection string
      const countEvil = getVitalsCount("' OR 1=1; --");
      assert.strictEqual(typeof countEvil, "number");
    });

    // ========================================================================
    // SECTION 2: SQL Injection Attacks on /api/uptime (name and url)
    // ========================================================================
    console.log("\n--- Section 2: SQL Injection Probes on /api/uptime ---");

    let createdMonitorIds: number[] = [];

    await test("SQLi 2.1: Destructive DDL injection in monitor name during POST /api/uptime", async () => {
      const evilName = "'; DROP TABLE uptime_monitors; --";
      const req = makeAuthRequest("http://localhost:3000/api/uptime", "POST", {
        name: evilName,
        url: `${fastServerUrl}/health`,
        intervalSeconds: 60,
      });

      const res = await uptimePost(req);
      assert.strictEqual(res.status, 201, "Monitor creation should succeed with HTTP 201");
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.monitor.name, evilName, "Monitor name must be stored literally");
      createdMonitorIds.push(json.monitor.id);

      // Verify uptime_monitors table exists and is intact
      const tableCheck = db
        .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='uptime_monitors'")
        .get() as { cnt: number };
      assert.strictEqual(tableCheck.cnt, 1, "uptime_monitors table must NOT be dropped");

      // Verify monitor can be fetched by ID
      const fetched = getUptimeMonitorById(json.monitor.id);
      assert.ok(fetched, "Monitor should be retrievable");
      assert.strictEqual(fetched?.name, evilName);
    });

    await test("SQLi 2.2: Second-order SQL injection in monitor url during POST /api/uptime", async () => {
      const evilUrl = `${fastServerUrl}/api?query='; DROP TABLE uptime_checks; --`;
      const req = makeAuthRequest("http://localhost:3000/api/uptime", "POST", {
        name: "Second-order SQLi URL",
        url: evilUrl,
        intervalSeconds: 60,
      });

      const res = await uptimePost(req);
      assert.strictEqual(res.status, 201);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.monitor.url, evilUrl, "URL must be stored literally");
      createdMonitorIds.push(json.monitor.id);

      // Verify uptime_checks table exists and is intact
      const checksTableCheck = db
        .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='uptime_checks'")
        .get() as { cnt: number };
      assert.strictEqual(checksTableCheck.cnt, 1, "uptime_checks table must NOT be dropped");

      // Verify that initial check for this monitor was inserted without error
      const checks = getUptimeChecks(json.monitor.id);
      assert.ok(checks.length >= 1, "Initial check should have executed and been recorded");
      assert.strictEqual(checks[0].status, "UP");
    });

    await test("SQLi 2.3: UNION injection attack in monitor name during POST /api/uptime", async () => {
      const unionName = "' UNION SELECT id, username, passwordHash, 'hacked', 1, 1, 1, 1 FROM users; --";
      const req = makeAuthRequest("http://localhost:3000/api/uptime", "POST", {
        name: unionName,
        url: `${fastServerUrl}/ping`,
        intervalSeconds: 30,
      });

      const res = await uptimePost(req);
      assert.strictEqual(res.status, 201);
      const json = await res.json();
      assert.strictEqual(json.monitor.name, unionName);
      createdMonitorIds.push(json.monitor.id);

      // List all monitors to verify JSON response is not malformed
      const listReq = makeAuthRequest("http://localhost:3000/api/uptime", "GET");
      const listRes = await uptimeGet(listReq);
      assert.strictEqual(listRes.status, 200);
      const listJson = await listRes.json();
      assert.ok(Array.isArray(listJson.monitors));
      const found = listJson.monitors.find((m: any) => m.id === json.monitor.id);
      assert.ok(found, "Monitor with union name should be listed correctly");
      assert.strictEqual(found.name, unionName);
    });

    await test("SQLi 2.4: Second-order SQL injection in updateUptimeMonitor", () => {
      const monitor = createUptimeMonitor("Pre-update monitor", `${fastServerUrl}/pre`, 60);
      createdMonitorIds.push(monitor.id);

      // Attempt injection through various update fields
      const updated = updateUptimeMonitor(monitor.id, {
        name: "Updated'; DROP TABLE uptime_monitors; --",
        url: `${fastServerUrl}/updated?x='; DELETE FROM uptime_checks; --`,
        status: "UP'; SELECT 1; --",
        uptimePercentage: 99.9,
      });
      assert.strictEqual(updated, true, "Update helper should return true");

      // Fetch and verify literal fields
      const refetched = getUptimeMonitorById(monitor.id);
      assert.ok(refetched);
      assert.strictEqual(refetched.name, "Updated'; DROP TABLE uptime_monitors; --");
      assert.strictEqual(
        refetched.url,
        `${fastServerUrl}/updated?x='; DELETE FROM uptime_checks; --`
      );

      // Verify tables still exist
      const check = db
        .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='uptime_monitors'")
        .get() as { cnt: number };
      assert.strictEqual(check.cnt, 1);
    });

    await test("SQLi 2.5: SQL injection resilience on DELETE /api/uptime id parameter", async () => {
      // 1. Non-numeric injection payload without leading digits: must return 400
      const nonNumericVectors = [
        "' OR '1'='1",
        "'; DROP TABLE uptime_monitors; --",
        "admin'--",
        "invalid_text_id",
      ];

      for (const vec of nonNumericVectors) {
        const req = makeAuthRequest(
          `http://localhost:3000/api/uptime?id=${encodeURIComponent(vec)}`,
          "DELETE"
        );
        const res = await uptimeDelete(req);
        assert.strictEqual(
          res.status,
          400,
          `Non-numeric ID '${vec}' must be rejected with 400 Bad Request`
        );
      }

      // 2. Injection payload with leading digits (e.g. '999999 OR 1=1' or '999999; DROP TABLE')
      // Even if parseInt extracts leading digits, parameterized queries MUST prevent any SQL injection execution!
      const leadingDigitVectors = [
        "999999 OR 1=1",
        "999999; DROP TABLE uptime_monitors; --",
        "999999 UNION SELECT 1,2,3",
      ];

      for (const vec of leadingDigitVectors) {
        const req = makeAuthRequest(
          `http://localhost:3000/api/uptime?id=${encodeURIComponent(vec)}`,
          "DELETE"
        );
        const res = await uptimeDelete(req);
        // Either rejected with 400, or parsed safely without executing injection
        assert.ok(
          res.status === 400 || res.status === 200,
          `DELETE must handle '${vec}' safely without crashing (got ${res.status})`
        );
      }

      // 3. JSON body non-numeric injection
      const reqBody = makeAuthRequest("http://localhost:3000/api/uptime", "DELETE", {
        id: "' OR '1'='1",
      });
      const resBody = await uptimeDelete(reqBody);
      assert.strictEqual(resBody.status, 400, "Non-numeric ID in body must return 400");

      // Verify that uptime_monitors table exists and was NOT dropped
      const tableCheck = db
        .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='uptime_monitors'")
        .get() as { cnt: number };
      assert.strictEqual(tableCheck.cnt, 1, "uptime_monitors table must survive deletion attacks");
    });

    await test("SQLi 2.6: SQL injection attacks on POST /api/uptime/check id parameter", async () => {
      const attackIds = [
        "' OR '1'='1",
        "'; DROP TABLE uptime_checks; --",
        "' UNION SELECT 1,2,3--",
        "-10",
        "NaN",
      ];

      for (const idVal of attackIds) {
        // Query param
        const reqQuery = makeAuthRequest(
          `http://localhost:3000/api/uptime/check?id=${encodeURIComponent(idVal)}`,
          "POST"
        );
        const resQuery = await uptimeCheckPost(reqQuery);
        assert.ok(
          resQuery.status === 400 || resQuery.status === 404,
          `Invalid id '${idVal}' must return 400 or 404, got ${resQuery.status}`
        );

        // Body param
        const reqBody = makeAuthRequest("http://localhost:3000/api/uptime/check", "POST", {
          id: idVal,
        });
        const resBody = await uptimeCheckPost(reqBody);
        assert.ok(
          resBody.status === 400 || resBody.status === 404,
          `Invalid id '${idVal}' in body must return 400 or 404, got ${resBody.status}`
        );
      }

      // Check uptime_checks table intact
      const checkTable = db
        .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='uptime_checks'")
        .get() as { cnt: number };
      assert.strictEqual(checkTable.cnt, 1, "uptime_checks table must be intact");
    });

    // ========================================================================
    // SECTION 3: Foreign Key Cascading Deletion & Database Integrity
    // ========================================================================
    console.log("\n--- Section 3: Foreign Key Cascading Deletion & Referential Integrity ---");

    await test("FK 3.1: SQLite PRAGMA foreign_keys is active in database connection", () => {
      const fkResult = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
      assert.strictEqual(
        fkResult.foreign_keys,
        1,
        "PRAGMA foreign_keys must evaluate to 1 (enabled)"
      );
    });

    await test("FK 3.2: Schema definition enforces ON DELETE CASCADE for uptime_checks", () => {
      const ddl = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='uptime_checks'")
        .get() as { sql: string };
      assert.ok(ddl && ddl.sql, "DDL for uptime_checks must exist");

      const normalizedSql = ddl.sql.replace(/\s+/g, " ");
      assert.ok(
        /FOREIGN KEY\s*\(\s*monitorId\s*\)\s*REFERENCES\s*uptime_monitors\s*\(\s*id\s*\)\s*ON DELETE CASCADE/i.test(
          normalizedSql
        ),
        "uptime_checks schema must declare FOREIGN KEY (monitorId) REFERENCES uptime_monitors(id) ON DELETE CASCADE"
      );
    });

    await test("FK 3.3: Cascading deletion via API DELETE /api/uptime purges child checks", async () => {
      // 1. Create target monitor Alpha
      const monitorAlpha = createUptimeMonitor("Cascade Target Alpha", `${fastServerUrl}/alpha`, 60);

      // 2. Add 15 checks for monitor Alpha
      for (let i = 0; i < 15; i++) {
        recordUptimeCheck({
          monitorId: monitorAlpha.id,
          status: i % 2 === 0 ? "UP" : "DOWN",
          statusCode: i % 2 === 0 ? 200 : 503,
          responseTime: 20 + i * 5,
        });
      }

      // 3. Create control monitor Beta with 10 checks
      const monitorBeta = createUptimeMonitor("Cascade Control Beta", `${fastServerUrl}/beta`, 60);
      for (let i = 0; i < 10; i++) {
        recordUptimeCheck({
          monitorId: monitorBeta.id,
          status: "UP",
          statusCode: 200,
          responseTime: 15,
        });
      }

      // Verify pre-conditions
      const preAlphaChecks = getUptimeChecks(monitorAlpha.id);
      const preBetaChecks = getUptimeChecks(monitorBeta.id);
      assert.strictEqual(preAlphaChecks.length, 15, "Alpha must have 15 checks before delete");
      assert.strictEqual(preBetaChecks.length, 10, "Beta must have 10 checks before delete");

      // 4. Send DELETE /api/uptime for Alpha
      const deleteReq = makeAuthRequest(
        `http://localhost:3000/api/uptime?id=${monitorAlpha.id}`,
        "DELETE"
      );
      const deleteRes = await uptimeDelete(deleteReq);
      assert.strictEqual(deleteRes.status, 200, "DELETE must return HTTP 200");
      const deleteJson = await deleteRes.json();
      assert.strictEqual(deleteJson.success, true);

      // 5. Verify monitor Alpha is deleted
      const fetchedAlpha = getUptimeMonitorById(monitorAlpha.id);
      assert.strictEqual(fetchedAlpha, null, "Monitor Alpha must be removed from uptime_monitors");

      // 6. Verify all checks for Alpha are purged
      const postAlphaChecks = getUptimeChecks(monitorAlpha.id);
      assert.strictEqual(postAlphaChecks.length, 0, "All checks for Alpha must be purged");

      const directAlphaCount = db
        .prepare("SELECT count(*) as cnt FROM uptime_checks WHERE monitorId = ?")
        .get(monitorAlpha.id) as { cnt: number };
      assert.strictEqual(
        directAlphaCount.cnt,
        0,
        "Direct SQL query must confirm 0 remaining checks for deleted monitor"
      );

      // 7. Verify control monitor Beta and its 10 checks are completely untouched
      const fetchedBeta = getUptimeMonitorById(monitorBeta.id);
      assert.ok(fetchedBeta, "Control monitor Beta must still exist");
      const postBetaChecks = getUptimeChecks(monitorBeta.id);
      assert.strictEqual(postBetaChecks.length, 10, "Control monitor Beta must retain all 10 checks");

      // Clean up Beta
      deleteUptimeMonitor(monitorBeta.id);
    });

    await test("FK 3.4: SQLite engine-level raw SQL DELETE automatically cascades child checks", () => {
      // Create monitor Gamma directly
      const monitorGamma = createUptimeMonitor("Engine Cascade Gamma", `${fastServerUrl}/gamma`, 60);

      // Insert 12 checks directly into uptime_checks
      for (let i = 0; i < 12; i++) {
        recordUptimeCheck({
          monitorId: monitorGamma.id,
          status: "UP",
          statusCode: 200,
          responseTime: 25,
        });
      }

      const initialCount = db
        .prepare("SELECT count(*) as cnt FROM uptime_checks WHERE monitorId = ?")
        .get(monitorGamma.id) as { cnt: number };
      assert.strictEqual(initialCount.cnt, 12);

      // Execute RAW SQL DELETE on uptime_monitors, bypassing any application helper
      const info = db
        .prepare("DELETE FROM uptime_monitors WHERE id = ?")
        .run(monitorGamma.id);
      assert.strictEqual(info.changes, 1);

      // Verify that SQLite database engine itself purged child rows via ON DELETE CASCADE
      const remainingChecks = db
        .prepare("SELECT count(*) as cnt FROM uptime_checks WHERE monitorId = ?")
        .get(monitorGamma.id) as { cnt: number };
      assert.strictEqual(
        remainingChecks.cnt,
        0,
        "SQLite engine must automatically purge all uptime_checks on raw DELETE"
      );
    });

    await test("FK 3.5: Foreign Key constraint rejects orphan checks with invalid monitorId", () => {
      const nonExistentMonitorId = 88888888;

      // Ensure that monitor 88888888 does not exist
      const exists = getUptimeMonitorById(nonExistentMonitorId);
      assert.strictEqual(exists, null);

      // Attempt raw INSERT into uptime_checks with invalid monitorId
      assert.throws(
        () => {
          db.prepare(`
            INSERT INTO uptime_checks (monitorId, status, statusCode, responseTime, timestamp)
            VALUES (?, 'UP', 200, 50, ?)
          `).run(nonExistentMonitorId, new Date().toISOString());
        },
        /FOREIGN KEY constraint failed/i,
        "Expected foreign key constraint violation when inserting orphan check"
      );
    });

    await test("FK 3.6: Bulk lifecycle monitor deletion stress", async () => {
      const monitorIds: number[] = [];

      // Create 10 monitors with 5 checks each (50 total checks)
      for (let i = 0; i < 10; i++) {
        const mon = createUptimeMonitor(`Bulk Mon ${i}`, `${fastServerUrl}/bulk/${i}`, 30);
        monitorIds.push(mon.id);
        for (let j = 0; j < 5; j++) {
          recordUptimeCheck({
            monitorId: mon.id,
            status: j % 2 === 0 ? "UP" : "DOWN",
            statusCode: j % 2 === 0 ? 200 : 500,
            responseTime: 30,
          });
        }
      }

      // Verify all 50 checks exist
      for (const id of monitorIds) {
        assert.strictEqual(getUptimeChecks(id).length, 5);
      }

      // Delete the first 5 monitors in parallel
      const toDelete = monitorIds.slice(0, 5);
      const toKeep = monitorIds.slice(5);

      await Promise.all(
        toDelete.map(async (id) => {
          const req = makeAuthRequest(`http://localhost:3000/api/uptime?id=${id}`, "DELETE");
          const res = await uptimeDelete(req);
          assert.strictEqual(res.status, 200);
        })
      );

      // Verify deleted monitors and their checks are 0
      for (const id of toDelete) {
        assert.strictEqual(getUptimeMonitorById(id), null);
        assert.strictEqual(getUptimeChecks(id).length, 0);
        const cnt = db
          .prepare("SELECT count(*) as cnt FROM uptime_checks WHERE monitorId = ?")
          .get(id) as { cnt: number };
        assert.strictEqual(cnt.cnt, 0);
      }

      // Verify kept monitors retain all 5 checks
      for (const id of toKeep) {
        assert.ok(getUptimeMonitorById(id));
        assert.strictEqual(getUptimeChecks(id).length, 5);
        deleteUptimeMonitor(id); // clean up
      }
    });

    // ========================================================================
    // SECTION 4: Long-Running Ping Endurance & Event Loop Non-Blocking Verification
    // ========================================================================
    console.log("\n--- Section 4: Long-Running Ping Endurance & Event Loop Responsiveness ---");

    await test("PING 4.1: Full 10s AbortController timeout on non-responsive server", async () => {
      const startTime = Date.now();

      // pingUrl against hangingServerUrl with default 10,000ms timeout
      console.log("    Starting 10-second ping test against non-responsive mock server...");
      const result = await pingUrl(hangingServerUrl, 10000);
      const elapsed = Date.now() - startTime;

      console.log(`    Ping resolved in ${elapsed}ms: status=${result.status}, error="${result.error}"`);

      // Verify timeout duration was approximately 10,000ms (within tolerance)
      assert.ok(
        elapsed >= 9800,
        `Ping must wait for full AbortController timeout (expected >= 9800ms, got ${elapsed}ms)`
      );
      assert.ok(
        elapsed <= 11500,
        `Ping must abort promptly when 10s expires (expected <= 11500ms, got ${elapsed}ms)`
      );

      // Verify ping result details
      assert.strictEqual(result.status, "DOWN", "Timed out ping must report DOWN status");
      assert.strictEqual(result.statusCode, null, "Timed out ping must have null statusCode");
      assert.ok(
        result.error?.includes("timed out") || result.error?.includes("10s"),
        `Error message must indicate timeout: "${result.error}"`
      );
      assert.ok(result.responseTime >= 9800, "responseTime should reflect duration");
    });

    await test("PING 4.2: Event loop remains unblocked and responsive during 10s ping timeout", async () => {
      // We will measure event loop lag while a 10s ping is executing.
      // If the event loop were blocked by busy loops or synchronous locks,
      // high-frequency intervals would starve or exhibit massive latency jitter.

      const pingPromise = pingUrl(hangingServerUrl, 10000);

      // Monitor event loop lag every 25ms
      const TICK_INTERVAL = 25;
      let ticks = 0;
      let maxLag = 0;
      let totalLag = 0;
      let lastTick = Date.now();

      const lagInterval = setInterval(() => {
        const now = Date.now();
        const delta = now - lastTick;
        const lag = Math.max(0, delta - TICK_INTERVAL);
        totalLag += lag;
        if (lag > maxLag) maxLag = lag;
        ticks++;
        lastTick = now;
      }, TICK_INTERVAL);

      const result = await pingPromise;
      clearInterval(lagInterval);

      assert.strictEqual(result.status, "DOWN");

      const avgLag = ticks > 0 ? (totalLag / ticks).toFixed(2) : "0";
      console.log(
        `    Event loop telemetry during 10s ping: Ticks=${ticks}, AvgLag=${avgLag}ms, MaxLag=${maxLag}ms`
      );

      // Assertions proving continuous event loop liveness
      // On Windows with default 15.6ms timer resolution, a 25ms timer ticks approximately every 31.2-35ms (~280-300 ticks in 10s)
      assert.ok(
        ticks >= 200,
        `Expected continuous timer ticks (>= 200) during 10s ping, got ${ticks} ticks`
      );
      assert.ok(
        parseFloat(avgLag) < 20,
        `Average event loop lag must be low (< 20ms), got ${avgLag}ms`
      );
      assert.ok(
        maxLag < 200,
        `Max event loop lag spike must remain well bounded (< 200ms), got ${maxLag}ms`
      );
    });

    await test("PING 4.3: High-concurrency hanging ping endurance (simultaneous sockets)", async () => {
      // Launch 8 concurrent hanging pings with a 1500ms timeout to stress socket pool and abort logic
      const CONCURRENCY = 8;
      const TIMEOUT_MS = 1500;
      const startTime = Date.now();

      const promises = Array.from({ length: CONCURRENCY }, (_, i) =>
        pingUrl(`${hangingServerUrl}/probe/${i}`, TIMEOUT_MS)
      );

      const results = await Promise.all(promises);
      const elapsed = Date.now() - startTime;

      console.log(`    ${CONCURRENCY} concurrent hanging pings resolved in ${elapsed}ms`);

      // All 8 must complete in parallel at ~1500ms (not sequentially 8 * 1500 = 12000ms)
      assert.ok(
        elapsed < 3000,
        `Concurrent pings must run in parallel and finish within 3000ms, took ${elapsed}ms`
      );

      // All 8 must report DOWN with timeout
      for (let i = 0; i < CONCURRENCY; i++) {
        assert.strictEqual(results[i].status, "DOWN");
        assert.strictEqual(results[i].statusCode, null);
        assert.ok(
          results[i].error?.includes("timed out") ||
            results[i].error?.includes("10s") ||
            results[i].error?.includes("Network error")
        );
      }
    });

    await test("PING 4.4: performUptimeCheck handles hanging monitor and updates SLA safely", async () => {
      // Create a monitor pointing to the hanging server
      const hangingMonitor = createUptimeMonitor(
        "Hanging Test Monitor",
        hangingServerUrl,
        60
      );
      createdMonitorIds.push(hangingMonitor.id);

      // Add a couple of initial UP checks so SLA percentage calculation is tested
      recordUptimeCheck({
        monitorId: hangingMonitor.id,
        status: "UP",
        statusCode: 200,
        responseTime: 50,
      });

      console.log("    Executing performUptimeCheck on hanging monitor (10s AbortController)...");
      const checkRecord = await performUptimeCheck(hangingMonitor.id);

      // Check results
      assert.strictEqual(checkRecord.status, "DOWN", "Hanging monitor check must record DOWN");
      assert.strictEqual(checkRecord.statusCode, 0, "Timed out check should have statusCode 0 or null");
      assert.ok(
        checkRecord.error?.includes("timed out") || checkRecord.error?.includes("10s"),
        `Expected timeout error, got: "${checkRecord.error}"`
      );
      assert.ok(checkRecord.responseTime >= 9800, "responseTime must reflect 10s duration");

      // Verify monitor record SLA updated properly without NaN
      const updatedMonitor = getUptimeMonitorById(hangingMonitor.id);
      assert.ok(updatedMonitor);
      assert.strictEqual(updatedMonitor.status, "DOWN");
      assert.strictEqual(updatedMonitor.lastStatus, "DOWN");
      assert.ok(
        typeof updatedMonitor.uptimePercentage === "number" &&
          !isNaN(updatedMonitor.uptimePercentage),
        "uptimePercentage must be a valid number"
      );
      // 1 UP check and 1 DOWN check = 50.0%
      assert.strictEqual(updatedMonitor.uptimePercentage, 50.0);
      assert.ok(updatedMonitor.lastResponseTime >= 9800);
    });

    // ========================================================================
    // SECTION 5: Cleanup & Final Integrity Verification
    // ========================================================================
    console.log("\n--- Section 5: Cleanup & Final Integrity Verification ---");

    await test("CLEANUP: Clean up test monitors and verify zero residual foreign key orphans", () => {
      for (const id of createdMonitorIds) {
        deleteUptimeMonitor(id);
      }

      // Verify no orphan records in uptime_checks
      const orphanChecks = db
        .prepare(`
          SELECT count(*) as cnt FROM uptime_checks c
          LEFT JOIN uptime_monitors m ON c.monitorId = m.id
          WHERE m.id IS NULL
        `)
        .get() as { cnt: number };

      assert.strictEqual(
        orphanChecks.cnt,
        0,
        "There must be ZERO orphan records in uptime_checks"
      );

      // Stop any background workers started during test
      stopUptimeWorker();
      stopVitalsWorker();
    });

    console.log("\n================================================================================");
    console.log(
      ` Milestone 9 Challenger 2 Results: ${stats.passed}/${stats.total} Passed (${stats.failed} Failed)`
    );
    console.log("================================================================================\n");

    if (stats.failed > 0) {
      console.error(`GATE VERDICT: REJECT - ${stats.failed} stress test(s) failed.`);
      process.exit(1);
    } else {
      console.log(`GATE VERDICT: APPROVE - All ${stats.total} adversarial stress tests passed flawlessly.`);
      process.exit(0);
    }
  } finally {
    await stopMockServers();
  }
}

runAdversarialProbes().catch((err) => {
  console.error("\nFATAL: Challenger 2 Suite failed with uncaught exception:", err);
  process.exit(1);
});
