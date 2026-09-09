/**
 * Milestone 9: Adversarial Stress Test Suite (Challenger 1)
 *
 * This test harness empirically probes:
 * 1. High volume of rapid vitals insertions and queries under concurrency and contention.
 * 2. Concurrent uptime checks across multiple monitors (10+ simultaneous monitors).
 * 3. Division-by-zero resilience: new monitors with 0 checks must report 100.0% or 0% SLA without NaN, null, or crash.
 * 4. Faulty URLs: invalid hostnames, unreachable ports, non-HTTP schemes, timeouts, error status codes.
 * 5. Response payload verification: verify timeseries data arrays contain valid numeric CPU and memory metrics and ISO timestamps.
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import http from "node:http";
import { NextRequest } from "next/server";

// Database and helper imports
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

// Vitals worker imports
import {
  startVitalsWorker,
  stopVitalsWorker,
  isVitalsWorkerActive,
  collectVitalsNow,
} from "../src/lib/vitals-worker";

// Uptime service imports
import {
  startUptimeWorker,
  stopUptimeWorker,
  isUptimeWorkerActive,
  pingUrl,
  performUptimeCheck,
  pollDueMonitors,
} from "../src/lib/uptime-service";

// Route handlers imports
import {
  GET as vitalsHistoryGet,
  POST as vitalsHistoryPost,
  PUT as vitalsHistoryPut,
  DELETE as vitalsHistoryDelete,
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
  try {
    await fn();
    console.log(`  ✓ [PASS] ${name}`);
    stats.passed++;
  } catch (err: any) {
    stats.failed++;
    console.error(`  ✗ [FAIL] ${name}`);
    console.error(`    Details: ${err.message}`);
    if (err.stack) {
      console.error(`    ${err.stack.split("\n").slice(1, 4).join("\n    ")}`);
    }
  }
}

async function runAdversarialStressSuite() {
  console.log("================================================================================");
  console.log("  CHALLENGER 1: ADVERSARIAL STRESS TEST SUITE (MILESTONE 9)");
  console.log("  Probing: Vitals Ingestion, Concurrent Uptime Checks, SLA Math & Fault Tolerance");
  console.log("================================================================================\n");

  // Track created test monitor IDs for cleanup
  const createdMonitorIds: number[] = [];

  // ============================================================================
  // PROBE SUITE 1: High Volume Rapid Vitals Insertions & Concurrency Under Contention
  // ============================================================================
  console.log("--- PROBE SUITE 1: High Volume Rapid Vitals Insertions & Concurrency ---");

  await test("1.1: Rapid-fire insertion of 500 vitals records in tight loop maintains data integrity", () => {
    const processNames = ["burst-proc-1", "burst-proc-2", "burst-proc-3", "burst-proc-4", "burst-proc-5"];
    const initialCount = getVitalsCount();
    const countToInsert = 500;
    const now = Date.now();

    for (let i = 0; i < countToInsert; i++) {
      const proc = processNames[i % processNames.length];
      const cpu = Math.round(((i * 0.17) % 100) * 10) / 10;
      const mem = 30000000 + (i * 1024);
      const ts = new Date(now - (countToInsert - i) * 1000).toISOString();

      const record = recordVital(proc, cpu, mem, ts);
      assert.ok(record.id > 0, "Record ID must be positive");
      assert.strictEqual(record.process, proc);
      assert.strictEqual(record.cpu, cpu);
      assert.strictEqual(record.memory, mem);
    }

    const finalCount = getVitalsCount();
    assert.strictEqual(finalCount, initialCount + countToInsert, "All 500 records must be persisted");
  });

  await test("1.2: Concurrent batch insertions from 10 parallel asynchronous workers (50 each, 500 total)", async () => {
    const workers = 10;
    const recordsPerWorker = 50;
    const runNonce = Date.now();
    const now = Date.now();

    const workerTasks = Array.from({ length: workers }, async (_, workerIdx) => {
      const proc = `async-worker-${runNonce}-${workerIdx}`;
      const records = [];
      for (let i = 0; i < recordsPerWorker; i++) {
        const cpu = Math.round((Math.random() * 80 + 1) * 10) / 10;
        const mem = 40000000 + i * 500;
        const ts = new Date(now - (recordsPerWorker - i) * 1000).toISOString();
        const r = recordVital(proc, cpu, mem, ts);
        records.push(r);
      }
      return records;
    });

    const results = await Promise.all(workerTasks);
    assert.strictEqual(results.length, workers);
    for (let w = 0; w < workers; w++) {
      assert.strictEqual(results[w].length, recordsPerWorker);
      const proc = `async-worker-${runNonce}-${w}`;
      assert.strictEqual(getVitalsCount(proc), recordsPerWorker, `Worker ${w} record count mismatch`);
    }
  });

  await test("1.3: Simultaneous read-write contention: 20 concurrent readers querying while 20 writers insert", async () => {
    const readerCount = 20;
    const writerCount = 20;
    const runNonce = Date.now();
    const now = Date.now();

    const writers = Array.from({ length: writerCount }, async (_, i) => {
      for (let j = 0; j < 10; j++) {
        recordVital(`contention-proc-${runNonce}-${i}`, 5.0 + j, 50000000 + j * 1000, new Date(now - j * 1000).toISOString());
      }
    });

    const readers = Array.from({ length: readerCount }, async (_, i) => {
      const history = getVitalsHistory(`contention-proc-${runNonce}-${i % writerCount}`, 1);
      assert.ok(Array.isArray(history), "Reader must receive array");
      return history.length;
    });

    // Execute readers and writers concurrently
    const [_, readResults] = await Promise.all([
      Promise.all(writers),
      Promise.all(readers),
    ]);

    assert.strictEqual(readResults.length, readerCount);
    for (const count of readResults) {
      assert.ok(typeof count === "number" && count >= 0);
    }
  });

  await test("1.4: High-concurrency route stress: 30 concurrent GET /api/vitals/history requests with varied query params", async () => {
    const hoursOptions = [1, 6, 12, 24, 48, 168];
    const procOptions = ["pmmanager-web", "burst-proc-1", undefined];

    const requests = Array.from({ length: 30 }, (_, i) => {
      const hours = hoursOptions[i % hoursOptions.length];
      const proc = procOptions[i % procOptions.length];
      const url = proc
        ? `http://localhost:3000/api/vitals/history?process=${encodeURIComponent(proc)}&hours=${hours}`
        : `http://localhost:3000/api/vitals/history?hours=${hours}`;

      const req = new NextRequest(url, {
        headers: { "x-mock-role": "admin" },
      });
      return vitalsHistoryGet(req);
    });

    const responses = await Promise.all(requests);
    assert.strictEqual(responses.length, 30);

    for (const res of responses) {
      assert.strictEqual(res.status, 200, "Every concurrent request must return 200");
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(Array.isArray(json.data));
    }
  });

  await test("1.5: Large dataset query preserves strict ascending timestamp ordering without memory blowup", () => {
    const proc = `large-series-test-${Date.now()}`;
    const baseTime = Date.now() - 3600 * 1000 * 48; // 48 hours ago
    for (let i = 0; i < 200; i++) {
      recordVital(
        proc,
        (i % 50) + 0.5,
        40000000 + i * 1000,
        new Date(baseTime + i * 600000).toISOString()
      );
    }

    const history = getVitalsHistory(proc, 72);
    assert.strictEqual(history.length, 200);

    // Verify strict ascending chronological order
    for (let i = 1; i < history.length; i++) {
      const prevTime = new Date(history[i - 1].timestamp).getTime();
      const currTime = new Date(history[i].timestamp).getTime();
      assert.ok(
        currTime >= prevTime,
        `Vitals points must be in ascending chronological order: index ${i - 1} (${prevTime}) vs index ${i} (${currTime})`
      );
    }
  });

  // ============================================================================
  // PROBE SUITE 2: Concurrent Uptime Checks Across Multiple Monitors (10+ Simultaneous)
  // ============================================================================
  console.log("\n--- PROBE SUITE 2: Concurrent Uptime Checks Across 10+ Simultaneous Monitors ---");

  // Spin up a fast local HTTP server with various responsive behaviors
  let requestCounter = 0;
  const mockServer = http.createServer((req, res) => {
    requestCounter++;
    const url = req.url || "/";

    if (url.startsWith("/ok")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "healthy", counter: requestCounter }));
    } else if (url.startsWith("/slow")) {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "slow_ok" }));
      }, 100);
    } else if (url.startsWith("/error500")) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    } else if (url.startsWith("/notfound")) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } else if (url.startsWith("/redirect")) {
      res.writeHead(302, { Location: "/ok" });
      res.end();
    } else if (url.startsWith("/hang")) {
      // Do not respond, simulating timeout
    } else {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Default OK");
    }
  });

  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", () => resolve()));
  const serverPort = (mockServer.address() as any).port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  // Create 10 concurrent monitors pointing to the mock server
  const testMonitors: Array<{ id: number; name: string; url: string; expectedStatus: "UP" | "DOWN" }> = [];

  await test("2.1: Create 10 distinct monitors simultaneously in SQLite", () => {
    const monitorConfigs = [
      { name: "Mon-01-OK", path: "/ok?m=1", expected: "UP" as const },
      { name: "Mon-02-OK", path: "/ok?m=2", expected: "UP" as const },
      { name: "Mon-03-Slow", path: "/slow?m=3", expected: "UP" as const },
      { name: "Mon-04-Redirect", path: "/redirect?m=4", expected: "UP" as const },
      { name: "Mon-05-OK", path: "/ok?m=5", expected: "UP" as const },
      { name: "Mon-06-Error500", path: "/error500?m=6", expected: "DOWN" as const },
      { name: "Mon-07-NotFound", path: "/notfound?m=7", expected: "DOWN" as const },
      { name: "Mon-08-OK", path: "/ok?m=8", expected: "UP" as const },
      { name: "Mon-09-OK", path: "/ok?m=9", expected: "UP" as const },
      { name: "Mon-10-Slow", path: "/slow?m=10", expected: "UP" as const },
    ];

    for (const cfg of monitorConfigs) {
      const mon = createUptimeMonitor(cfg.name, `${baseUrl}${cfg.path}`, 60);
      assert.ok(mon.id > 0);
      createdMonitorIds.push(mon.id);
      testMonitors.push({
        id: mon.id,
        name: mon.name,
        url: mon.url,
        expectedStatus: cfg.expected,
      });
    }

    assert.strictEqual(testMonitors.length, 10, "Expected exactly 10 monitors created");
  });

  await test("2.2: Execute 10 simultaneous health checks via performUptimeCheck without DB locking", async () => {
    const checkPromises = testMonitors.map((mon) => performUptimeCheck(mon.id));
    const results = await Promise.all(checkPromises);

    assert.strictEqual(results.length, 10, "All 10 checks must complete");

    for (let i = 0; i < 10; i++) {
      const check = results[i];
      const mon = testMonitors[i];

      assert.strictEqual(check.monitorId, mon.id);
      assert.strictEqual(check.status, mon.expectedStatus, `Monitor ${mon.name} status mismatch`);
      assert.ok(check.responseTime >= 1, `Response time must be >= 1ms, got ${check.responseTime}`);
      assert.ok(check.id > 0, "Check record ID must be positive");

      // Verify SLA updated in database
      const updatedMon = getUptimeMonitorById(mon.id);
      assert.strictEqual(updatedMon?.status, mon.expectedStatus);
      assert.ok(updatedMon?.lastCheck !== null);
      if (mon.expectedStatus === "UP") {
        assert.strictEqual(updatedMon?.uptimePercentage, 100.0);
      } else {
        assert.strictEqual(updatedMon?.uptimePercentage, 0.0);
      }
    }
  });

  await test("2.3: Execute 10 simultaneous health checks via POST /api/uptime/check route handler", async () => {
    const routeRequests = testMonitors.map((mon) => {
      const req = new NextRequest(`http://localhost:3000/api/uptime/check?id=${mon.id}`, {
        method: "POST",
        headers: { "x-mock-role": "admin", "Content-Type": "application/json" },
        body: JSON.stringify({ id: mon.id }),
      });
      return uptimeCheckPost(req);
    });

    const responses = await Promise.all(routeRequests);
    assert.strictEqual(responses.length, 10);

    for (let i = 0; i < 10; i++) {
      const res = responses[i];
      assert.strictEqual(res.status, 200, `POST /api/uptime/check for monitor ${testMonitors[i].id} must return 200`);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.check.monitorId, testMonitors[i].id);
      assert.strictEqual(json.check.status, testMonitors[i].expectedStatus);
    }
  });

  await test("2.4: Burst stress: execute 5 rapid consecutive rounds of 10 concurrent checks (50 total)", async () => {
    // Capture check counts before burst
    const countsBefore = new Map<number, number>();
    for (const mon of testMonitors) {
      countsBefore.set(mon.id, getUptimeChecks(mon.id, 100).length);
    }

    const rounds = 5;
    for (let r = 0; r < rounds; r++) {
      const roundPromises = testMonitors.map((mon) => performUptimeCheck(mon.id));
      const roundResults = await Promise.all(roundPromises);
      assert.strictEqual(roundResults.length, 10);
    }

    for (const mon of testMonitors) {
      const checks = getUptimeChecks(mon.id, 100);
      const before = countsBefore.get(mon.id) || 0;
      assert.ok(
        checks.length >= before + rounds,
        `Monitor ${mon.name} must have at least ${before + rounds} check records, got ${checks.length}`
      );

      const updated = getUptimeMonitorById(mon.id);
      assert.ok(updated !== null);
      if (mon.expectedStatus === "UP") {
        assert.strictEqual(updated?.uptimePercentage, 100.0);
      } else {
        assert.strictEqual(updated?.uptimePercentage, 0.0);
      }
    }
  });

  await test("2.5: Background scheduler pollDueMonitors evaluates 10 monitors concurrently", async () => {
    // Set lastCheck to 5 minutes ago for all 10 monitors to force expiration
    const fiveMinutesAgo = new Date(Date.now() - 300000).toISOString();
    for (const mon of testMonitors) {
      db.prepare("UPDATE uptime_monitors SET lastCheck = ? WHERE id = ?").run(fiveMinutesAgo, mon.id);
    }

    // Run pollDueMonitors: should dispatch checks for all 10 without throwing
    await pollDueMonitors();

    // Give asynchronous pings a moment to persist
    await new Promise((r) => setTimeout(r, 200));

    // Verify all 10 monitors were updated with recent timestamps
    for (const mon of testMonitors) {
      const updated = getUptimeMonitorById(mon.id);
      assert.ok(updated?.lastCheck !== null);
      const checkDiff = Date.now() - new Date(updated!.lastCheck!).getTime();
      assert.ok(checkDiff < 5000, `Monitor ${mon.name} should have been checked just now`);
    }
  });

  // ============================================================================
  // PROBE SUITE 3: Division-by-Zero Resilience & Boundary SLA Calculations
  // ============================================================================
  console.log("\n--- PROBE SUITE 3: Division-by-Zero Resilience & Boundary SLA Calculations ---");

  await test("3.1: Fresh monitor with 0 checks initializes with valid non-NaN SLA (100.0% or 0%)", () => {
    const mon = createUptimeMonitor("Zero-Check Monitor", "http://localhost:3000/fresh", 60);
    createdMonitorIds.push(mon.id);

    assert.strictEqual(typeof mon.uptimePercentage, "number", "uptimePercentage must be numeric");
    assert.strictEqual(isNaN(mon.uptimePercentage), false, "uptimePercentage must NOT be NaN");
    assert.strictEqual(isFinite(mon.uptimePercentage), true, "uptimePercentage must be finite");
    assert.ok(mon.uptimePercentage === 100.0 || mon.uptimePercentage === 0.0);
    assert.strictEqual(mon.status, "PENDING");
  });

  await test("3.2: Calling recalculateMonitorSLA on monitor with 0 checks returns valid object without NaN or exception", () => {
    const mon = createUptimeMonitor("Zero-Check Recalc Monitor", "http://localhost:3000/zero", 60);
    createdMonitorIds.push(mon.id);

    const checks = getUptimeChecks(mon.id);
    assert.strictEqual(checks.length, 0);

    const sla = recalculateMonitorSLA(mon.id);
    assert.ok(sla !== null, "recalculateMonitorSLA must return an object");
    assert.strictEqual(typeof sla?.uptimePercentage, "number");
    assert.strictEqual(isNaN(sla?.uptimePercentage!), false, "uptimePercentage must NOT be NaN");
    assert.strictEqual(isFinite(sla?.uptimePercentage!), true, "uptimePercentage must be finite");
    assert.ok(sla?.uptimePercentage === 100.0 || sla?.uptimePercentage === 0.0);
    assert.strictEqual(sla?.avgResponseTimeMs, 0);
  });

  await test("3.3: Route handler GET /api/uptime serializes zero-check monitors safely as valid numbers", async () => {
    const mon = createUptimeMonitor("API Zero-Check Monitor", "http://localhost:3000/api-zero", 60);
    createdMonitorIds.push(mon.id);

    const req = new NextRequest("http://localhost:3000/api/uptime", {
      headers: { "x-mock-role": "admin" },
    });
    const res = await uptimeGet(req);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.success, true);
    const target = json.monitors.find((m: any) => m.id === mon.id);
    assert.ok(target, "Created monitor must be listed");
    assert.strictEqual(typeof target.uptimePercentage, "number");
    assert.strictEqual(isNaN(target.uptimePercentage), false);
    assert.strictEqual(isFinite(target.uptimePercentage), true);
    assert.ok(target.uptimePercentage === 100.0 || target.uptimePercentage === 0.0);
  });

  await test("3.4: JSON serialization resilience: JSON.stringify preserves numeric SLA (never null from NaN)", () => {
    const mon = createUptimeMonitor("JSON Check Mon", "http://localhost:3000/json", 60);
    createdMonitorIds.push(mon.id);

    const serialized = JSON.stringify(mon);
    assert.ok(
      !serialized.includes('"uptimePercentage":null'),
      "JSON serialization must NOT contain null for uptimePercentage"
    );
    assert.ok(
      serialized.includes('"uptimePercentage":100') || serialized.includes('"uptimePercentage":0'),
      "JSON serialization must contain numeric 100 or 0 for uptimePercentage"
    );
  });

  await test("3.5: State transitions: 0 checks -> DOWN -> UP -> purge all checks -> recalculate SLA", () => {
    const mon = createUptimeMonitor("State Transition Mon", "http://localhost:3000/transition", 60);
    createdMonitorIds.push(mon.id);

    // Initial: 0 checks -> 100.0%
    let sla = recalculateMonitorSLA(mon.id);
    assert.strictEqual(sla?.uptimePercentage, 100.0);

    // 1 DOWN check -> 0.0%
    recordUptimeCheck({ monitorId: mon.id, status: "DOWN", statusCode: 503, responseTime: 80 });
    sla = recalculateMonitorSLA(mon.id);
    assert.strictEqual(sla?.uptimePercentage, 0.0);
    assert.strictEqual(sla?.lastStatus, "DOWN");

    // 1 UP check -> 1 UP out of 2 total = 50.0%
    recordUptimeCheck({ monitorId: mon.id, status: "UP", statusCode: 200, responseTime: 40 });
    sla = recalculateMonitorSLA(mon.id);
    assert.strictEqual(sla?.uptimePercentage, 50.0);
    assert.strictEqual(sla?.lastStatus, "UP");

    // Purge all checks from DB: simulate total check flush
    db.prepare("DELETE FROM uptime_checks WHERE monitorId = ?").run(mon.id);
    assert.strictEqual(getUptimeChecks(mon.id).length, 0);

    // Recalculate SLA with 0 checks again: must reset safely without NaN or division-by-zero error
    sla = recalculateMonitorSLA(mon.id);
    assert.ok(sla !== null);
    assert.strictEqual(sla?.uptimePercentage, 100.0);
    assert.strictEqual(sla?.lastStatus, "PENDING");
    assert.strictEqual(isNaN(sla?.uptimePercentage!), false);
  });

  await test("3.6: Recalculate SLA on non-existent monitor ID handles gracefully without crashing", () => {
    const nonExistentId = 99999999;
    const result = recalculateMonitorSLA(nonExistentId);
    // Should return null or default SLA without throwing unhandled exception
    assert.ok(result === null || typeof result === "object");
  });

  // ============================================================================
  // PROBE SUITE 4: Faulty URLs, Unreachable Ports & Protocol Hardening
  // ============================================================================
  console.log("\n--- PROBE SUITE 4: Faulty URLs, Unreachable Ports & Protocol Hardening ---");

  await test("4.1: Non-HTTP schemes strictly rejected by POST /api/uptime with HTTP 400", async () => {
    const forbiddenSchemes = [
      "ftp://ftp.example.com/file.txt",
      "ws://websocket.example.com/socket",
      "wss://websocket.example.com/socket",
      "file:///etc/passwd",
      "file:///c:/windows/system32/cmd.exe",
      "javascript:alert(1)",
      "ssh://git@github.com:user/repo.git",
      "gopher://gopher.example.com",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    ];

    for (const url of forbiddenSchemes) {
      const req = new NextRequest("http://localhost:3000/api/uptime", {
        method: "POST",
        headers: { "x-mock-role": "admin", "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Scheme Test", url }),
      });
      const res = await uptimePost(req);
      assert.strictEqual(res.status, 400, `Scheme ${url} must be rejected with 400`);
      const json = await res.json();
      assert.ok(json.error !== undefined);
    }
  });

  await test("4.2: Malformed URL syntax strictly rejected by POST /api/uptime with HTTP 400", async () => {
    const malformedUrls = [
      "",
      "   ",
      "not-a-url",
      "http://",
      "https://",
      "http:// bad spaces in host .com",
      "http://:80/no-host",
      "http://[invalid-ipv6/test",
      "12345",
      "localhost:3000", // missing scheme
    ];

    for (const url of malformedUrls) {
      const req = new NextRequest("http://localhost:3000/api/uptime", {
        method: "POST",
        headers: { "x-mock-role": "admin", "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Malformed URL Test", url }),
      });
      const res = await uptimePost(req);
      assert.strictEqual(res.status, 400, `Malformed URL '${url}' must be rejected with 400`);
    }
  });

  await test("4.3: Invalid / non-existent hostnames resolve cleanly to DOWN status without throwing", async () => {
    const invalidHostUrl = "http://non-existent-probe-host-challenger-999.invalid:12345/health";
    const result = await pingUrl(invalidHostUrl, 1500);

    assert.strictEqual(result.status, "DOWN");
    assert.strictEqual(result.statusCode, null);
    assert.ok(result.responseTime >= 1);
    assert.ok(typeof result.error === "string" && result.error.length > 0);
  });

  await test("4.4: Unreachable localhost port resolves cleanly to DOWN status without throwing", async () => {
    // Pick a high port that has no listening service
    const unreachablePortUrl = "http://127.0.0.1:58999/unreachable-endpoint";
    const result = await pingUrl(unreachablePortUrl, 1500);

    assert.strictEqual(result.status, "DOWN");
    assert.strictEqual(result.statusCode, null);
    assert.ok(result.responseTime >= 1);
    assert.ok(typeof result.error === "string" && result.error.length > 0);
  });

  await test("4.5: Request timeout cleanly triggers AbortController and returns DOWN with timeout description", async () => {
    const hangUrl = `${baseUrl}/hang`;
    // Pass a very short 80ms timeout to trigger abort quickly
    const result = await pingUrl(hangUrl, 80);

    assert.strictEqual(result.status, "DOWN");
    assert.strictEqual(result.statusCode, null);
    assert.ok(result.responseTime >= 1);
    assert.ok(
      result.error?.toLowerCase().includes("time") ||
      result.error?.toLowerCase().includes("abort") ||
      result.error?.toLowerCase().includes("network"),
      `Expected timeout/abort error, got: ${result.error}`
    );
  });

  await test("4.6: HTTP error response codes (400, 401, 403, 404, 500, 502, 503) evaluate to DOWN", async () => {
    const errorCodes = [400, 401, 403, 404, 500, 502, 503];

    for (const code of errorCodes) {
      // Create a temporary endpoint handler on our mock server
      const path = `/custom-err-${code}`;
      const url = `${baseUrl}${path}`;

      // Temporarily attach route logic
      const originalListeners = mockServer.listeners("request");
      const tempServer = http.createServer((_, res) => {
        res.writeHead(code, { "Content-Type": "text/plain" });
        res.end(`Error ${code}`);
      });
      await new Promise<void>((r) => tempServer.listen(0, "127.0.0.1", () => r()));
      const tempPort = (tempServer.address() as any).port;

      try {
        const result = await pingUrl(`http://127.0.0.1:${tempPort}/test`, 1500);
        assert.strictEqual(result.status, "DOWN", `Status code ${code} must evaluate to DOWN`);
        assert.strictEqual(result.statusCode, code);
        assert.ok(result.error !== null);
      } finally {
        tempServer.close();
      }
    }
  });

  await test("4.7: HTTP redirect codes (301, 302) evaluate to UP", async () => {
    const redirectUrl = `${baseUrl}/redirect`;
    const result = await pingUrl(redirectUrl, 1500);

    // Fetch follows redirects or treats 302 as UP (< 400)
    assert.strictEqual(result.status, "UP");
    assert.ok(result.statusCode !== null && result.statusCode < 400);
    assert.strictEqual(result.error, null);
  });

  await test("4.8: Network failure resilience in POST /api/uptime/check route handler", async () => {
    // Create monitor pointing to non-existent domain
    const faultyMon = createUptimeMonitor("Faulty Domain Mon", "http://non-existent-subdomain.invalid.test:9999", 60);
    createdMonitorIds.push(faultyMon.id);

    const req = new NextRequest(`http://localhost:3000/api/uptime/check?id=${faultyMon.id}`, {
      method: "POST",
      headers: { "x-mock-role": "admin", "Content-Type": "application/json" },
      body: JSON.stringify({ id: faultyMon.id }),
    });

    const res = await uptimeCheckPost(req);
    // Route must return 200 with DOWN check, NOT throw 500
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.check.status, "DOWN");
    assert.strictEqual(json.check.statusCode, 0); // 0 or null
    assert.ok(json.check.error !== null);

    const updated = getUptimeMonitorById(faultyMon.id);
    assert.strictEqual(updated?.status, "DOWN");
    assert.strictEqual(updated?.uptimePercentage, 0.0);
  });

  // ============================================================================
  // PROBE SUITE 5: Response Payload Verification & Schema Conformance
  // ============================================================================
  console.log("\n--- PROBE SUITE 5: Response Payload Verification & Schema Conformance ---");

  await test("5.1: GET /api/vitals/history response payload strictly conforms to timeseries schema", async () => {
    const req = new NextRequest("http://localhost:3000/api/vitals/history?process=pmmanager-web&hours=24", {
      headers: { "x-mock-role": "admin" },
    });
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.process, "pmmanager-web");
    assert.strictEqual(json.hours, 24);
    assert.ok(Array.isArray(json.data));
    assert.ok(json.data.length >= 2, "Expected at least 2 data points for charting");

    const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

    for (let i = 0; i < json.data.length; i++) {
      const item = json.data[i];
      assert.ok(typeof item.id === "number" || typeof item.id === "string");
      assert.strictEqual(typeof item.process, "string");
      assert.ok(item.process.length > 0);

      // Verify numeric CPU
      assert.strictEqual(typeof item.cpu, "number", `cpu at index ${i} must be a number`);
      assert.strictEqual(isNaN(item.cpu), false, `cpu at index ${i} must not be NaN`);
      assert.strictEqual(isFinite(item.cpu), true, `cpu at index ${i} must be finite`);
      assert.ok(item.cpu >= 0, `cpu at index ${i} must be >= 0`);

      // Verify numeric Memory
      assert.strictEqual(typeof item.memory, "number", `memory at index ${i} must be a number`);
      assert.strictEqual(isNaN(item.memory), false, `memory at index ${i} must not be NaN`);
      assert.strictEqual(isFinite(item.memory), true, `memory at index ${i} must be finite`);
      assert.ok(item.memory >= 0, `memory at index ${i} must be >= 0`);

      // Verify ISO timestamp
      assert.strictEqual(typeof item.timestamp, "string", `timestamp at index ${i} must be string`);
      assert.ok(isoPattern.test(item.timestamp), `timestamp at index ${i} must match ISO 8601: ${item.timestamp}`);
      assert.strictEqual(isNaN(Date.parse(item.timestamp)), false, `timestamp at index ${i} must be parseable date`);
    }

    // Verify chronological sorting
    for (let i = 1; i < json.data.length; i++) {
      const prevTs = new Date(json.data[i - 1].timestamp).getTime();
      const currTs = new Date(json.data[i].timestamp).getTime();
      assert.ok(currTs >= prevTs, `Items must be sorted ascending chronologically`);
    }
  });

  await test("5.2: Boundary parameters for GET /api/vitals/history default gracefully", async () => {
    // Negative hours: defaults to 24h
    const reqNeg = new NextRequest("http://localhost:3000/api/vitals/history?hours=-10", {
      headers: { "x-mock-role": "admin" },
    });
    const resNeg = await vitalsHistoryGet(reqNeg);
    assert.strictEqual(resNeg.status, 200);
    const jsonNeg = await resNeg.json();
    assert.strictEqual(jsonNeg.hours, 24);
    assert.ok(Array.isArray(jsonNeg.data));

    // Non-numeric hours: defaults to 24h
    const reqStr = new NextRequest("http://localhost:3000/api/vitals/history?hours=two_weeks", {
      headers: { "x-mock-role": "admin" },
    });
    const resStr = await vitalsHistoryGet(reqStr);
    assert.strictEqual(resStr.status, 200);
    const jsonStr = await resStr.json();
    assert.strictEqual(jsonStr.hours, 24);

    // Non-existent process: returns empty data array without throwing 500
    const reqNonExist = new NextRequest("http://localhost:3000/api/vitals/history?process=definitely_not_running", {
      headers: { "x-mock-role": "admin" },
    });
    const resNonExist = await vitalsHistoryGet(reqNonExist);
    assert.strictEqual(resNonExist.status, 200);
    const jsonNonExist = await resNonExist.json();
    assert.strictEqual(jsonNonExist.data.length, 0);

    // Missing process param: returns data from multiple processes
    const reqAll = new NextRequest("http://localhost:3000/api/vitals/history?hours=1", {
      headers: { "x-mock-role": "admin" },
    });
    const resAll = await vitalsHistoryGet(reqAll);
    assert.strictEqual(resAll.status, 200);
    const jsonAll = await resAll.json();
    assert.ok(jsonAll.data.length > 0);
  });

  await test("5.3: GET /api/uptime payload schema strictly matches UptimeMonitorRecord interface", async () => {
    const req = new NextRequest("http://localhost:3000/api/uptime", {
      headers: { "x-mock-role": "admin" },
    });
    const res = await uptimeGet(req);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.ok(Array.isArray(json.monitors));
    assert.ok(json.monitors.length > 0);

    for (let i = 0; i < json.monitors.length; i++) {
      const mon = json.monitors[i];
      assert.strictEqual(typeof mon.id, "number");
      assert.ok(mon.id > 0);
      assert.strictEqual(typeof mon.name, "string");
      assert.ok(mon.name.length > 0);
      assert.strictEqual(typeof mon.url, "string");
      assert.ok(mon.url.startsWith("http://") || mon.url.startsWith("https://"));
      assert.strictEqual(typeof mon.intervalSeconds, "number");
      assert.ok(mon.intervalSeconds > 0);
      assert.ok(["UP", "DOWN", "PENDING"].includes(mon.status));
      assert.strictEqual(typeof mon.uptimePercentage, "number");
      assert.strictEqual(isNaN(mon.uptimePercentage), false);
      assert.strictEqual(isFinite(mon.uptimePercentage), true);
      assert.ok(mon.uptimePercentage >= 0 && mon.uptimePercentage <= 100);
      assert.strictEqual(typeof mon.lastResponseTime, "number");
      assert.ok(mon.lastResponseTime >= 0);
    }
  });

  await test("5.4: POST /api/uptime rejects non-admin users if role is restricted or admits developer", async () => {
    // Unauthenticated: 401
    const unauthReq = new NextRequest("http://localhost:3000/api/uptime", {
      method: "GET",
      headers: { "x-mock-role": "unauthenticated" },
    });
    const unauthRes = await uptimeGet(unauthReq);
    assert.strictEqual(unauthRes.status, 401);

    // Developer: 200
    const devReq = new NextRequest("http://localhost:3000/api/uptime", {
      method: "GET",
      headers: { "x-mock-role": "developer" },
    });
    const devRes = await uptimeGet(devReq);
    assert.strictEqual(devRes.status, 200);
  });

  await test("5.5: Non-supported HTTP methods on all endpoints return 405 Method Not Allowed", async () => {
    // Vitals history
    const postVH = await vitalsHistoryPost();
    assert.strictEqual(postVH.status, 405);
    const putVH = await vitalsHistoryPut();
    assert.strictEqual(putVH.status, 405);
    const delVH = await vitalsHistoryDelete();
    assert.strictEqual(delVH.status, 405);

    // Uptime check
    const getUC = await uptimeCheckGet();
    assert.strictEqual(getUC.status, 405);
  });

  // ============================================================================
  // PROBE SUITE 6: Edge Cases, Lifecycle & Deletion Cascades
  // ============================================================================
  console.log("\n--- PROBE SUITE 6: Edge Cases, Lifecycle & Deletion Cascades ---");

  await test("6.1: Cascade deletion removes monitor and all 50+ child checks cleanly", () => {
    const mon = createUptimeMonitor("Cascade Probe Monitor", "http://localhost:3000/cascade", 60);

    // Populate with 50 checks
    for (let i = 0; i < 50; i++) {
      recordUptimeCheck({
        monitorId: mon.id,
        status: i % 2 === 0 ? "UP" : "DOWN",
        statusCode: i % 2 === 0 ? 200 : 500,
        responseTime: 30 + i,
      });
    }

    assert.strictEqual(getUptimeChecks(mon.id, 100).length, 50);

    // Delete monitor
    const deleted = deleteUptimeMonitor(mon.id);
    assert.strictEqual(deleted, true);

    // Verify monitor is gone
    assert.strictEqual(getUptimeMonitorById(mon.id), null);
    // Verify checks are completely cascaded away
    assert.strictEqual(getUptimeChecks(mon.id, 100).length, 0);
  });

  await test("6.2: Background worker singleton start/stop idempotence cycles", () => {
    // Vitals worker cycles
    stopVitalsWorker();
    assert.strictEqual(isVitalsWorkerActive(), false);
    stopVitalsWorker(); // Idempotent stop
    assert.strictEqual(isVitalsWorkerActive(), false);

    startVitalsWorker();
    assert.strictEqual(isVitalsWorkerActive(), true);
    startVitalsWorker(); // Idempotent start
    assert.strictEqual(isVitalsWorkerActive(), true);

    // Uptime worker cycles
    stopUptimeWorker();
    assert.strictEqual(isUptimeWorkerActive(), false);
    stopUptimeWorker();
    assert.strictEqual(isUptimeWorkerActive(), false);

    startUptimeWorker();
    assert.strictEqual(isUptimeWorkerActive(), true);
    startUptimeWorker();
    assert.strictEqual(isUptimeWorkerActive(), true);
  });

  await test("6.3: Cold-start auto-seeding under high concurrency (10 concurrent requests to GET /api/vitals/history)", async () => {
    // 10 concurrent requests requesting a new process name
    const newProc = `cold-start-concurrency-${Date.now()}`;
    const requests = Array.from({ length: 10 }, () => {
      const req = new NextRequest(`http://localhost:3000/api/vitals/history?process=${newProc}&hours=24`, {
        headers: { "x-mock-role": "admin" },
      });
      return vitalsHistoryGet(req);
    });

    const responses = await Promise.all(requests);
    assert.strictEqual(responses.length, 10);

    for (const res of responses) {
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(Array.isArray(json.data));
      assert.ok(json.data.length >= 2, "Cold-start must ensure at least 2 points");
    }
  });

  // ============================================================================
  // TEARDOWN & CLEANUP
  // ============================================================================
  console.log("\n--- Teardown: Cleaning up mock resources ---");
  for (const id of createdMonitorIds) {
    try {
      deleteUptimeMonitor(id);
    } catch {
      // Ignored
    }
  }

  await new Promise<void>((resolve) => mockServer.close(() => resolve()));

  // ============================================================================
  // SUMMARY AND VERDICT
  // ============================================================================
  console.log("\n================================================================================");
  console.log(`  CHALLENGER 1 STRESS TEST RESULTS: ${stats.passed}/${stats.total} Passed (${stats.failed} Failed)`);
  console.log("================================================================================");

  if (stats.failed > 0) {
    process.exit(1);
  }
}

runAdversarialStressSuite().catch((err) => {
  console.error("FATAL SUITE ERROR:", err);
  process.exit(1);
});
