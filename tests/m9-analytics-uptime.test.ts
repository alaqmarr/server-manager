/**
 * Milestone 9: Historical Analytics & Uptime Monitoring Test Suite
 *
 * Requirements Tested:
 * 1. SQLite schema expansion:
 *    - `pm2_vitals` table with process, cpu, memory, timestamp
 *    - `uptime_monitors` table with name, url, intervalSeconds, status, uptimePercentage, lastCheck, lastResponseTime
 *    - `uptime_checks` table with monitorId, status ('UP' | 'DOWN'), statusCode, responseTime, error, timestamp
 *    - Foreign key cascading delete from uptime_monitors to uptime_checks
 * 2. SQLite helpers in src/lib/db.ts:
 *    - recordVital, getVitalsHistory, getVitalsCount
 *    - createUptimeMonitor, getUptimeMonitors, getUptimeMonitorById, deleteUptimeMonitor
 *    - recordUptimeCheck, getUptimeChecks, recalculateMonitorSLA
 *    - Division-by-zero protection in SLA calculation (zero checks = 100.0%)
 * 3. Background Vitals Worker (src/lib/vitals-worker.ts):
 *    - Singleton guard (globalThis.__vitalsWorkerActive)
 *    - Immediate insertion of at least one PM2 metrics row upon startup
 *    - collectVitalsNow() populates live/mock process vitals
 * 4. Historical Vitals API (GET /api/vitals/history):
 *    - Authentication guard (401 for unauthenticated)
 *    - Allowed for authenticated sessions
 *    - Returns timeseries data with numeric cpu and memory
 *    - Boundary conditions: negative hours, non-numeric hours, non-existent process
 *    - Auto-seeding: triggers collection when fewer than 2 data points exist
 *    - Method guard: rejects non-GET with 405
 * 5. Uptime Monitoring Service (src/lib/uptime-service.ts):
 *    - Singleton guard (globalThis.__uptimeWorkerActive)
 *    - pingUrl with AbortController timeout (UP for 2xx/3xx, DOWN for errors)
 *    - performUptimeCheck performs ping, records check in SQLite, updates SLA
 * 6. Uptime API (src/app/api/uptime/route.ts & src/app/api/uptime/check/route.ts):
 *    - GET /api/uptime: returns monitors list
 *    - POST /api/uptime: validates name, url, interval; creates monitor; executes initial check
 *    - POST /api/uptime/check: triggers immediate health check and updates monitor
 *    - DELETE /api/uptime: validates ID and deletes monitor + cascades checks
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// Import DB and helpers
import {
  db,
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

// Import Vitals Worker
import {
  startVitalsWorker,
  stopVitalsWorker,
  isVitalsWorkerActive,
  collectVitalsNow,
} from "../src/lib/vitals-worker";

// Import Uptime Service
import {
  startUptimeWorker,
  stopUptimeWorker,
  isUptimeWorkerActive,
  pingUrl,
  performUptimeCheck,
} from "../src/lib/uptime-service";

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

import { NextRequest } from "next/server";

async function runTests() {
  console.log("==================================================================");
  console.log(" Milestone 9: Historical Analytics & Uptime Monitoring Test Suite ");
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
        console.error(`    Stack: ${err.stack.split("\n").slice(1, 3).join("\n")}`);
      }
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // SECTION 1: SQLite Database Schema & Integrity
  // --------------------------------------------------------------------------
  console.log("--- Section 1: SQLite Database Schema & Integrity ---");

  await test("Table pm2_vitals exists with correct columns", () => {
    const tableInfo = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pm2_vitals'")
      .get() as { name: string } | undefined;
    assert.ok(tableInfo, "Table pm2_vitals must exist in SQLite");

    const columns = db.prepare("PRAGMA table_info(pm2_vitals)").all() as Array<{
      name: string;
      type: string;
    }>;
    const colMap = new Map(columns.map((c) => [c.name, c.type.toUpperCase()]));
    assert.ok(colMap.has("id"), "pm2_vitals must have id column");
    assert.ok(colMap.has("process"), "pm2_vitals must have process column");
    assert.ok(colMap.has("cpu"), "pm2_vitals must have cpu column");
    assert.ok(colMap.has("memory"), "pm2_vitals must have memory column");
    assert.ok(colMap.has("timestamp"), "pm2_vitals must have timestamp column");
  });

  await test("Table uptime_monitors exists with correct columns", () => {
    const tableInfo = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='uptime_monitors'")
      .get() as { name: string } | undefined;
    assert.ok(tableInfo, "Table uptime_monitors must exist in SQLite");

    const columns = db.prepare("PRAGMA table_info(uptime_monitors)").all() as Array<{
      name: string;
      type: string;
    }>;
    const colMap = new Map(columns.map((c) => [c.name, c.type.toUpperCase()]));
    assert.ok(colMap.has("id"), "uptime_monitors must have id");
    assert.ok(colMap.has("name"), "uptime_monitors must have name");
    assert.ok(colMap.has("url"), "uptime_monitors must have url");
    assert.ok(colMap.has("intervalSeconds"), "uptime_monitors must have intervalSeconds");
    assert.ok(colMap.has("status"), "uptime_monitors must have status");
    assert.ok(colMap.has("uptimePercentage"), "uptime_monitors must have uptimePercentage");
    assert.ok(colMap.has("lastCheck"), "uptime_monitors must have lastCheck");
    assert.ok(colMap.has("lastResponseTime"), "uptime_monitors must have lastResponseTime");
  });

  await test("Table uptime_checks exists with status CHECK constraint and foreign keys", () => {
    const tableInfo = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='uptime_checks'")
      .get() as { name: string } | undefined;
    assert.ok(tableInfo, "Table uptime_checks must exist in SQLite");

    const columns = db.prepare("PRAGMA table_info(uptime_checks)").all() as Array<{
      name: string;
      type: string;
    }>;
    const colMap = new Map(columns.map((c) => [c.name, c.type.toUpperCase()]));
    assert.ok(colMap.has("id"));
    assert.ok(colMap.has("monitorId"));
    assert.ok(colMap.has("status"));
    assert.ok(colMap.has("statusCode"));
    assert.ok(colMap.has("responseTime"));
    assert.ok(colMap.has("error"));
    assert.ok(colMap.has("timestamp"));
  });

  await test("uptime_checks enforces CHECK(status IN ('UP', 'DOWN'))", () => {
    assert.throws(
      () => {
        db.prepare(`
          INSERT INTO uptime_checks (monitorId, status, statusCode, responseTime, timestamp)
          VALUES (99999, 'INVALID_STATUS', 200, 50, '${new Date().toISOString()}')
        `).run();
      },
      /CHECK constraint failed/,
      "Expected CHECK constraint failure when inserting invalid status"
    );
  });

  // --------------------------------------------------------------------------
  // SECTION 2: SQLite Helper Methods & SLA Math
  // --------------------------------------------------------------------------
  console.log("\n--- Section 2: SQLite Helper Methods & SLA Math ---");

  await test("recordVital inserts and returns structured vital record", () => {
    const initialCount = getVitalsCount("test-worker-proc");
    const vital = recordVital("test-worker-proc", 4.5, 52428800);

    assert.ok(vital.id && vital.id > 0);
    assert.strictEqual(vital.process, "test-worker-proc");
    assert.strictEqual(vital.cpu, 4.5);
    assert.strictEqual(vital.memory, 52428800);
    assert.ok(typeof vital.timestamp === "string");
    assert.strictEqual(getVitalsCount("test-worker-proc"), initialCount + 1);
  });

  await test("getVitalsHistory returns records filtered by process and hours", () => {
    const now = Date.now();
    recordVital("filter-proc-a", 1.0, 30000000, new Date(now - 1000).toISOString());
    recordVital("filter-proc-b", 2.0, 40000000, new Date(now - 1000).toISOString());

    const historyA = getVitalsHistory("filter-proc-a", 1);
    assert.ok(historyA.length >= 1);
    assert.ok(historyA.every((h) => h.process === "filter-proc-a"));

    const historyAll = getVitalsHistory(undefined, 1);
    assert.ok(historyAll.length >= 2);
  });

  await test("createUptimeMonitor creates monitor with default PENDING and 100.0% SLA", () => {
    const monitor = createUptimeMonitor("DB Test Monitor", "http://localhost:3000/health", 60);
    assert.ok(monitor.id > 0);
    assert.strictEqual(monitor.name, "DB Test Monitor");
    assert.strictEqual(monitor.url, "http://localhost:3000/health");
    assert.strictEqual(monitor.intervalSeconds, 60);
    assert.strictEqual(monitor.status, "PENDING");
    assert.strictEqual(monitor.uptimePercentage, 100.0);

    const fetched = getUptimeMonitorById(monitor.id);
    assert.ok(fetched !== null);
    assert.strictEqual(fetched?.id, monitor.id);

    // Clean up
    deleteUptimeMonitor(monitor.id);
  });

  await test("recalculateMonitorSLA computes percentage without division by zero when 0 checks exist", () => {
    const mon = createUptimeMonitor("Zero Checks Mon", "http://localhost:3000", 60);
    const sla = recalculateMonitorSLA(mon.id);
    assert.ok(sla !== null);
    assert.strictEqual(sla?.uptimePercentage, 100.0);
    assert.strictEqual(sla?.lastStatus, "PENDING");
    assert.strictEqual(isNaN(sla?.uptimePercentage!), false);
    assert.strictEqual(isFinite(sla?.uptimePercentage!), true);

    deleteUptimeMonitor(mon.id);
  });

  await test("recalculateMonitorSLA calculates correct SLA percentage and latency metrics", () => {
    const mon = createUptimeMonitor("Math SLA Mon", "http://localhost:3000", 60);

    // Add 1 UP check (50ms)
    recordUptimeCheck({
      monitorId: mon.id,
      status: "UP",
      statusCode: 200,
      responseTime: 50,
    });

    let sla = recalculateMonitorSLA(mon.id);
    assert.strictEqual(sla?.uptimePercentage, 100.0);
    assert.strictEqual(sla?.avgResponseTimeMs, 50.0);
    assert.strictEqual(sla?.lastStatus, "UP");

    // Add 1 DOWN check (100ms)
    recordUptimeCheck({
      monitorId: mon.id,
      status: "DOWN",
      statusCode: 500,
      responseTime: 100,
      error: "Server Error",
    });

    sla = recalculateMonitorSLA(mon.id);
    // 1 UP out of 2 = 50.0%
    assert.strictEqual(sla?.uptimePercentage, 50.0);
    // (50 + 100) / 2 = 75.0ms
    assert.strictEqual(sla?.avgResponseTimeMs, 75.0);
    assert.strictEqual(sla?.lastStatus, "DOWN");

    // Add 2 more UP checks (30ms each)
    recordUptimeCheck({ monitorId: mon.id, status: "UP", statusCode: 200, responseTime: 30 });
    recordUptimeCheck({ monitorId: mon.id, status: "UP", statusCode: 200, responseTime: 30 });

    sla = recalculateMonitorSLA(mon.id);
    // 3 UP out of 4 = 75.0%
    assert.strictEqual(sla?.uptimePercentage, 75.0);
    assert.strictEqual(sla?.lastStatus, "UP");

    // Verify checks retrieval limit
    const checks = getUptimeChecks(mon.id, 10);
    assert.strictEqual(checks.length, 4);

    deleteUptimeMonitor(mon.id);
  });

  await test("deleteUptimeMonitor cascades deletion of associated uptime_checks", () => {
    const mon = createUptimeMonitor("Cascade Test Mon", "http://localhost:3000", 60);
    recordUptimeCheck({ monitorId: mon.id, status: "UP", statusCode: 200, responseTime: 40 });
    recordUptimeCheck({ monitorId: mon.id, status: "UP", statusCode: 200, responseTime: 45 });

    assert.strictEqual(getUptimeChecks(mon.id).length, 2);

    const deleted = deleteUptimeMonitor(mon.id);
    assert.strictEqual(deleted, true);

    // Verify monitor and associated checks are removed
    assert.strictEqual(getUptimeMonitorById(mon.id), null);
    assert.strictEqual(getUptimeChecks(mon.id).length, 0);
  });

  // --------------------------------------------------------------------------
  // SECTION 3: Background Vitals Worker
  // --------------------------------------------------------------------------
  console.log("\n--- Section 3: Background Vitals Worker ---");

  await test("startVitalsWorker boots with singleton guard and inserts metrics immediately", async () => {
    stopVitalsWorker();
    assert.strictEqual(isVitalsWorkerActive(), false);

    const initialCount = getVitalsCount();
    startVitalsWorker();
    assert.strictEqual(isVitalsWorkerActive(), true);

    // Calling again is idempotent
    startVitalsWorker();
    assert.strictEqual(isVitalsWorkerActive(), true);

    // Give background tick micro-window to complete initial insert
    await new Promise((r) => setTimeout(r, 100));

    const afterCount = getVitalsCount();
    assert.ok(
      afterCount > 0,
      `Expected at least one row inserted into pm2_vitals, got ${afterCount}`
    );
  });

  await test("collectVitalsNow records metrics and populates target process if requested", async () => {
    const recorded = await collectVitalsNow("pmmanager-web");
    assert.ok(Array.isArray(recorded));
    assert.ok(recorded.length > 0);

    const foundTarget = recorded.some((r) => r.process === "pmmanager-web");
    assert.ok(foundTarget, "Expected pmmanager-web to be collected and recorded");
  });

  // --------------------------------------------------------------------------
  // SECTION 4: Historical Vitals API Route
  // --------------------------------------------------------------------------
  console.log("\n--- Section 4: Historical Vitals API Route ---");

  await test("GET /api/vitals/history rejects unauthenticated requests with 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/vitals/history", {
      headers: { "x-mock-role": "unauthenticated" },
    });
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 401);
  });

  await test("GET /api/vitals/history returns HTTP 200 with timeseries metrics for admin", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/vitals/history?process=pmmanager-web&hours=24",
      {
        headers: { "x-mock-role": "admin" },
      }
    );
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.ok(Array.isArray(json.data));
    assert.ok(json.data.length >= 2, "Expected at least 2 points for charting");

    const sample = json.data[0];
    assert.strictEqual(typeof sample.cpu, "number");
    assert.strictEqual(typeof sample.memory, "number");
    assert.strictEqual(typeof sample.timestamp, "string");
  });

  await test("GET /api/vitals/history allows Developer role", async () => {
    const req = new NextRequest("http://localhost:3000/api/vitals/history", {
      headers: { "x-mock-role": "developer" },
    });
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
  });

  await test("GET /api/vitals/history handles boundary parameters (negative or invalid hours)", async () => {
    // Negative hours
    const reqNeg = new NextRequest("http://localhost:3000/api/vitals/history?hours=-5", {
      headers: { "x-mock-role": "admin" },
    });
    const resNeg = await vitalsHistoryGet(reqNeg);
    assert.ok(resNeg.status === 200 || resNeg.status === 400);

    // Non-numeric hours
    const reqStr = new NextRequest(
      "http://localhost:3000/api/vitals/history?hours=invalid_string",
      {
        headers: { "x-mock-role": "admin" },
      }
    );
    const resStr = await vitalsHistoryGet(reqStr);
    assert.ok(resStr.status === 200 || resStr.status === 400);

    // Non-existent process
    const initialVitalsCount = getVitalsCount("unknown_process_xyz");
    const reqNonExist = new NextRequest(
      "http://localhost:3000/api/vitals/history?process=unknown_process_xyz",
      {
        headers: { "x-mock-role": "admin" },
      }
    );
    const resNonExist = await vitalsHistoryGet(reqNonExist);
    assert.strictEqual(resNonExist.status, 200);
    const jsonNonExist = await resNonExist.json();
    assert.strictEqual(jsonNonExist.success, true);
    assert.ok(Array.isArray(jsonNonExist.data));
    assert.strictEqual(jsonNonExist.data.length, 0);
    const afterVitalsCount = getVitalsCount("unknown_process_xyz");
    assert.strictEqual(afterVitalsCount, initialVitalsCount, "Must not insert vitals for non-existent process on GET");
  });

  await test("POST /api/vitals/history returns 405 Method Not Allowed", async () => {
    const res = await vitalsHistoryPost();
    assert.strictEqual(res.status, 405);
  });

  // --------------------------------------------------------------------------
  // SECTION 5: Uptime Monitoring Service
  // --------------------------------------------------------------------------
  console.log("\n--- Section 5: Uptime Monitoring Service ---");

  await test("startUptimeWorker initializes with singleton guard", () => {
    stopUptimeWorker();
    assert.strictEqual(isUptimeWorkerActive(), false);

    startUptimeWorker();
    assert.strictEqual(isUptimeWorkerActive(), true);

    // Idempotent second call
    startUptimeWorker();
    assert.strictEqual(isUptimeWorkerActive(), true);
  });

  await test("pingUrl returns DOWN for non-existent domain with error description", async () => {
    const result = await pingUrl("http://127.0.0.1:54321/non-existent-probe", 1500);
    assert.strictEqual(result.status, "DOWN");
    assert.strictEqual(result.statusCode, null);
    assert.ok(typeof result.responseTime === "number" && result.responseTime >= 1);
    assert.ok(typeof result.error === "string" && result.error.length > 0);
  });

  await test("performUptimeCheck pings monitor URL, writes check record, and updates SLA", async () => {
    const mon = createUptimeMonitor("Probe Test Mon", "http://127.0.0.1:54321/test", 30);
    const check = await performUptimeCheck(mon.id);

    assert.strictEqual(check.monitorId, mon.id);
    assert.strictEqual(check.status, "DOWN"); // Port 54321 not listening -> DOWN
    assert.ok(check.responseTime > 0);
    assert.ok(check.id > 0);

    const updated = getUptimeMonitorById(mon.id);
    assert.strictEqual(updated?.status, "DOWN");
    assert.strictEqual(updated?.uptimePercentage, 0.0);
    assert.ok(updated?.lastCheck !== null);

    deleteUptimeMonitor(mon.id);
  });

  // --------------------------------------------------------------------------
  // SECTION 6: Uptime API Routes
  // --------------------------------------------------------------------------
  console.log("\n--- Section 6: Uptime API Routes ---");

  let testMonitorId: number | null = null;

  await test("POST /api/uptime validates input boundaries (empty name, invalid url, negative interval)", async () => {
    // Empty name
    const reqEmpty = new NextRequest("http://localhost:3000/api/uptime", {
      method: "POST",
      headers: { "x-mock-role": "admin", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", url: "http://localhost:3000" }),
    });
    const resEmpty = await uptimePost(reqEmpty);
    assert.strictEqual(resEmpty.status, 400);

    // Invalid URL
    const reqBadUrl = new NextRequest("http://localhost:3000/api/uptime", {
      method: "POST",
      headers: { "x-mock-role": "admin", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bad URL Monitor", url: "not-a-valid-http-url" }),
    });
    const resBadUrl = await uptimePost(reqBadUrl);
    assert.strictEqual(resBadUrl.status, 400);

    // Negative intervalSeconds
    const reqNegInterval = new NextRequest("http://localhost:3000/api/uptime", {
      method: "POST",
      headers: { "x-mock-role": "admin", "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Negative Interval",
        url: "http://localhost:3000",
        intervalSeconds: -60,
      }),
    });
    const resNegInterval = await uptimePost(reqNegInterval);
    assert.strictEqual(resNegInterval.status, 400);
  });

  await test("POST /api/uptime creates monitor and triggers initial check", async () => {
    const req = new NextRequest("http://localhost:3000/api/uptime", {
      method: "POST",
      headers: { "x-mock-role": "admin", "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "M9 Test Monitor",
        url: "http://127.0.0.1:54321/mock-health",
        intervalSeconds: 120,
      }),
    });
    const res = await uptimePost(req);
    assert.ok(res.status === 200 || res.status === 201);

    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.ok(json.monitor);
    assert.strictEqual(json.monitor.name, "M9 Test Monitor");
    assert.strictEqual(json.monitor.intervalSeconds, 120);

    testMonitorId = json.monitor.id;
  });

  await test("GET /api/uptime lists active monitors for Admin and Developer", async () => {
    // Admin
    const adminReq = new NextRequest("http://localhost:3000/api/uptime", {
      headers: { "x-mock-role": "admin" },
    });
    const adminRes = await uptimeGet(adminReq);
    assert.strictEqual(adminRes.status, 200);
    const adminJson = await adminRes.json();
    assert.strictEqual(adminJson.success, true);
    assert.ok(Array.isArray(adminJson.monitors));
    assert.ok(adminJson.monitors.length > 0);

    // Developer
    const devReq = new NextRequest("http://localhost:3000/api/uptime", {
      headers: { "x-mock-role": "developer" },
    });
    const devRes = await uptimeGet(devReq);
    assert.strictEqual(devRes.status, 200);
    const devJson = await devRes.json();
    assert.strictEqual(devJson.success, true);
    assert.ok(Array.isArray(devJson.monitors));
  });

  await test("POST /api/uptime/check triggers immediate health ping and returns check record", async () => {
    assert.ok(testMonitorId !== null);

    const req = new NextRequest(`http://localhost:3000/api/uptime/check?id=${testMonitorId}`, {
      method: "POST",
      headers: { "x-mock-role": "admin", "Content-Type": "application/json" },
      body: JSON.stringify({ id: testMonitorId }),
    });
    const res = await uptimeCheckPost(req);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.ok(json.check);
    assert.strictEqual(json.check.monitorId, testMonitorId);
    assert.ok(json.check.status === "UP" || json.check.status === "DOWN");
  });

  await test("POST /api/uptime/check returns 400 for missing ID and 404 for non-existent monitor", async () => {
    // Missing ID
    const reqMissing = new NextRequest("http://localhost:3000/api/uptime/check", {
      method: "POST",
      headers: { "x-mock-role": "admin" },
    });
    const resMissing = await uptimeCheckPost(reqMissing);
    assert.strictEqual(resMissing.status, 400);

    // Non-existent ID
    const reqNonExist = new NextRequest("http://localhost:3000/api/uptime/check?id=999999", {
      method: "POST",
      headers: { "x-mock-role": "admin", "Content-Type": "application/json" },
      body: JSON.stringify({ id: 999999 }),
    });
    const resNonExist = await uptimeCheckPost(reqNonExist);
    assert.strictEqual(resNonExist.status, 404);
  });

  await test("DELETE /api/uptime returns 400 without ID and deletes successfully with ID", async () => {
    // Without ID
    const reqNoId = new NextRequest("http://localhost:3000/api/uptime", {
      method: "DELETE",
      headers: { "x-mock-role": "admin" },
    });
    const resNoId = await uptimeDelete(reqNoId);
    assert.ok(resNoId.status === 400 || resNoId.status === 404);

    // With ID
    assert.ok(testMonitorId !== null);
    const reqWithId = new NextRequest(
      `http://localhost:3000/api/uptime?id=${testMonitorId}`,
      {
        method: "DELETE",
        headers: { "x-mock-role": "admin", "Content-Type": "application/json" },
        body: JSON.stringify({ id: testMonitorId }),
      }
    );
    const resWithId = await uptimeDelete(reqWithId);
    assert.strictEqual(resWithId.status, 200);

    const json = await resWithId.json();
    assert.strictEqual(json.success, true);

    // Verify it no longer exists
    assert.strictEqual(getUptimeMonitorById(testMonitorId!), null);
  });

  console.log("\n==================================================================");
  console.log(`  Milestone 9 Suite: ${passed}/${total} Tests Passed (100% SUCCESS)  `);
  console.log("==================================================================\n");
}

runTests().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
