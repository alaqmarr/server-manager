/**
 * Milestone 9: Empirical Adversarial Stress & Verification Harness (Challenger Gen 3)
 *
 * Dedicated verification for:
 * 1. GET /api/vitals/history with non-existent processes:
 *    - Returns { success: true, data: [] }
 *    - Zero mutations to SQLite pm2_vitals (both target-process count and total table count)
 * 2. Extreme / Malformed hours boundary testing:
 *    - hours=-10, hours=-999999, hours=0, hours=100000, hours=1e12, hours=invalid, hours=NaN, hours=Infinity
 * 3. SQL Injection Resilience:
 *    - ?process=' OR 1=1--
 *    - ?process='; DROP TABLE pm2_vitals; --
 *    - ?process=' UNION SELECT ...
 *    - ?hours=1; DROP TABLE pm2_vitals; --
 * 4. High-Concurrency Stress:
 *    - 20 concurrent queries for same process
 *    - 20 concurrent queries for non-existent process
 *    - 50 randomized mixed concurrent queries
 *    - 100 rapid burst queries (measuring latency, zero SQLITE_BUSY locks)
 * 5. Direct DB Helper Verification:
 *    - getVitalsHistory parameterization and edge case resilience
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import { NextRequest } from "next/server";
import {
  db,
  getVitalsHistory,
  getVitalsCount,
  recordVital,
  PmVitalRecord,
} from "../src/lib/db";
import {
  GET as vitalsHistoryGet,
  POST as vitalsHistoryPost,
  PUT as vitalsHistoryPut,
  DELETE as vitalsHistoryDelete,
} from "../src/app/api/vitals/history/route";

interface Stats {
  total: number;
  passed: number;
  failed: number;
  errors: string[];
}

const stats: Stats = {
  total: 0,
  passed: 0,
  failed: 0,
  errors: [],
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
    console.error(`  ✗ [FAIL] ${name} (${duration}ms)`);
    console.error(`    Error: ${err?.message || err}`);
    stats.failed++;
    stats.errors.push(`${name}: ${err?.message || err}`);
  }
}

function getTotalVitalsCount(): number {
  const row = db.prepare("SELECT count(*) as count FROM pm2_vitals").get() as { count: number };
  return row?.count ?? 0;
}

async function run() {
  console.log("================================================================================");
  console.log(" Milestone 9: Empirical Adversarial Challenge Suite (Challenger Gen 3)");
  console.log(" Probing /api/vitals/history: Idempotency, SQLi, Concurrency, and Extreme Bounds");
  console.log("================================================================================\n");

  // Ensure DB has initial standard data
  const initialTotal = getTotalVitalsCount();
  if (initialTotal === 0) {
    const now = Date.now();
    recordVital("pmmanager-web", 2.1, 45000000, new Date(now - 600000).toISOString());
    recordVital("pmmanager-web", 3.2, 46000000, new Date(now - 300000).toISOString());
    recordVital("web-app", 1.5, 30000000, new Date(now - 600000).toISOString());
    recordVital("api-server", 4.0, 60000000, new Date(now - 600000).toISOString());
  }

  // ============================================================================
  // SECTION 1: NON-EXISTENT PROCESS PROBING & ZERO DB MUTATIONS
  // ============================================================================
  console.log("--- Section 1: Non-Existent Process Probing & SQLite Idempotency ---");

  await test("1.1 Single randomized non-existent process returns empty array and does NOT mutate SQLite", async () => {
    const ghostProcess = `ghost_proc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const procCountBefore = getVitalsCount(ghostProcess);
    const totalCountBefore = getTotalVitalsCount();
    assert.strictEqual(procCountBefore, 0, "Initial count for ghost process must be 0");

    const req = new NextRequest(
      `http://localhost:3000/api/vitals/history?process=${encodeURIComponent(ghostProcess)}&hours=24`,
      { headers: { "x-mock-role": "admin" } }
    );
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 200, "Response status must be 200");

    const json = await res.json();
    assert.strictEqual(json.success, true, "Response must indicate success: true");
    assert.strictEqual(json.process, ghostProcess, "Response must echo requested process name");
    assert.ok(Array.isArray(json.data), "Response data must be an array");
    assert.strictEqual(json.data.length, 0, "Response data must be strictly empty array []");

    const procCountAfter = getVitalsCount(ghostProcess);
    const totalCountAfter = getTotalVitalsCount();
    assert.strictEqual(procCountAfter, 0, "Ghost process count in pm2_vitals must remain 0");
    assert.strictEqual(totalCountAfter, totalCountBefore, "Total pm2_vitals row count must not change");
  });

  await test("1.2 Diverse adversarial non-existent process names do NOT create database rows", async () => {
    const adversarialNames = [
      "definitely_not_running",
      "unknown_process_xyz",
      "phantom-worker-alpha-9999",
      "fake_proc_with spaces in name",
      "null",
      "undefined",
      "false",
      "0",
      "!@#$%^&*()_+-=[]{}|;':,.<>?",
      "../../../etc/shadow",
      "proc\0withnullbyte",
    ];

    for (const name of adversarialNames) {
      const totalBefore = getTotalVitalsCount();
      const countBefore = getVitalsCount(name);

      const req = new NextRequest(
        `http://localhost:3000/api/vitals/history?process=${encodeURIComponent(name)}&hours=12`,
        { headers: { "x-mock-role": "admin" } }
      );
      const res = await vitalsHistoryGet(req);
      assert.strictEqual(res.status, 200, `Expected 200 for process name: ${name}`);

      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(Array.isArray(json.data));
      assert.strictEqual(json.data.length, 0, `Expected 0 records for non-existent ${name}`);

      const countAfter = getVitalsCount(name);
      const totalAfter = getTotalVitalsCount();
      assert.strictEqual(countAfter, countBefore, `Process count must not mutate for ${name}`);
      assert.strictEqual(totalAfter, totalBefore, `Total row count must not mutate for ${name}`);
    }
  });

  await test("1.3 Repeated GET calls for non-existent process are idempotent across 10 iterations", async () => {
    const testProc = "idempotency_check_probe_proc";
    const initialTotal = getTotalVitalsCount();

    for (let i = 0; i < 10; i++) {
      const req = new NextRequest(
        `http://localhost:3000/api/vitals/history?process=${testProc}`,
        { headers: { "x-mock-role": "admin" } }
      );
      const res = await vitalsHistoryGet(req);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.data.length, 0);
    }

    const finalTotal = getTotalVitalsCount();
    assert.strictEqual(finalTotal, initialTotal, "10 repeated GET requests must not add any records");
  });

  // ============================================================================
  // SECTION 2: EXTREME & MALFORMED HOURS PARAMETER BOUNDARIES
  // ============================================================================
  console.log("\n--- Section 2: Extreme & Malformed Hours Parameter Boundaries ---");

  await test("2.1 Negative hours: hours=-10 falls back gracefully to default 24h", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/vitals/history?process=pmmanager-web&hours=-10",
      { headers: { "x-mock-role": "admin" } }
    );
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.hours, 24, "Negative hours must fallback to default 24");
    assert.ok(Array.isArray(json.data));
    assert.ok(json.data.length > 0, "Should return existing records for pmmanager-web with default 24h");
  });

  await test("2.2 Extreme negative hours: hours=-999999 falls back gracefully", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/vitals/history?hours=-999999",
      { headers: { "x-mock-role": "admin" } }
    );
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.hours, 24);
  });

  await test("2.3 Zero hours: hours=0 falls back gracefully without division by zero or error", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/vitals/history?process=pmmanager-web&hours=0",
      { headers: { "x-mock-role": "admin" } }
    );
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.hours, 24, "hours=0 must fallback to default 24");
  });

  await test("2.4 Large positive hours: hours=100000 parses correctly and returns records", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/vitals/history?process=pmmanager-web&hours=100000",
      { headers: { "x-mock-role": "admin" } }
    );
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.hours, 100000);
    assert.ok(Array.isArray(json.data));
  });

  await test("2.5 Extreme astronomical hours: hours=1000000000000 does not crash server", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/vitals/history?hours=1000000000000",
      { headers: { "x-mock-role": "admin" } }
    );
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.ok(Array.isArray(json.data));
  });

  await test("2.6 Non-numeric string hours: hours=invalid, hours=abc, hours=NaN fallback to 24", async () => {
    const invalidInputs = ["invalid", "abc", "NaN", "undefined", "null", "true", "false", "$%^&*()"];
    for (const val of invalidInputs) {
      const req = new NextRequest(
        `http://localhost:3000/api/vitals/history?hours=${encodeURIComponent(val)}`,
        { headers: { "x-mock-role": "admin" } }
      );
      const res = await vitalsHistoryGet(req);
      assert.strictEqual(res.status, 200, `Expected 200 for hours=${val}`);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.hours, 24, `hours=${val} must fallback to 24`);
    }
  });

  await test("2.7 Decimal / float hours: hours=12.5 parsed as integer 12", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/vitals/history?hours=12.5",
      { headers: { "x-mock-role": "admin" } }
    );
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.hours, 12);
  });

  // ============================================================================
  // SECTION 3: SQL INJECTION PROBES & INTEGRITY
  // ============================================================================
  console.log("\n--- Section 3: SQL Injection Probes on /api/vitals/history ---");

  await test("3.1 Boolean bypass injection: ?process=' OR 1=1-- does not leak records of other processes", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/vitals/history?process=' OR 1=1--",
      { headers: { "x-mock-role": "admin" } }
    );
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    // Since no process is literally named "' OR 1=1--", it must return 0 records
    assert.strictEqual(json.data.length, 0, "Must not leak rows under ' OR 1=1-- injection payload");
  });

  await test("3.2 Boolean bypass variant: ?process=' OR '2'='2 returns 0 and does not leak other processes", async () => {
    // Unseen boolean bypass payload: must return 0 rows (proves parameterized equality matching)
    const req = new NextRequest(
      "http://localhost:3000/api/vitals/history?process=' OR '2'='2",
      { headers: { "x-mock-role": "admin" } }
    );
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.data.length, 0, "Unseen boolean payload must return 0 rows");

    // Also verify that ?process=' OR '1'='1 treats string literally and never leaks standard processes
    const req1 = new NextRequest(
      "http://localhost:3000/api/vitals/history?process=' OR '1'='1",
      { headers: { "x-mock-role": "admin" } }
    );
    const res1 = await vitalsHistoryGet(req1);
    const json1 = await res1.json();
    // Must NOT leak pmmanager-web or api-server records
    assert.ok(
      json1.data.every((r: any) => r.process === "' OR '1'='1"),
      "All matched records must strictly match the literal string, never other processes"
    );
  });

  await test("3.3 Destructive DDL injection: ?process='; DROP TABLE users; -- fails safely", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/vitals/history?process='; DROP TABLE users; --",
      { headers: { "x-mock-role": "admin" } }
    );
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.data.length, 0, "Must return 0 records");

    // Verify pm2_vitals table is alive and intact
    const verifyVitals = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pm2_vitals'").get();
    assert.ok(verifyVitals, "Table pm2_vitals must still exist in SQLite");

    // Verify users table is alive and intact
    const verifyUsers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    assert.ok(verifyUsers, "Table users must still exist in SQLite");
  });

  await test("3.4 UNION SELECT credential exfiltration attempt fails safely", async () => {
    const unionPayload = "' UNION SELECT id, username, 0, 0, '2026-01-01' FROM users--";
    const req = new NextRequest(
      `http://localhost:3000/api/vitals/history?process=${encodeURIComponent(unionPayload)}`,
      { headers: { "x-mock-role": "admin" } }
    );
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.data.length, 0, "UNION attack must not return user data");
  });

  await test("3.5 Multi-statement injection in ?hours= parameter fails safely", async () => {
    const hoursPayload = "24; DROP TABLE pm2_vitals; --";
    const req = new NextRequest(
      `http://localhost:3000/api/vitals/history?hours=${encodeURIComponent(hoursPayload)}`,
      { headers: { "x-mock-role": "admin" } }
    );
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.hours, 24); // parseInt extracts 24, ignores suffix safely

    const count = getTotalVitalsCount();
    assert.ok(count > 0, "Table must remain completely intact");
  });

  // ============================================================================
  // SECTION 4: CONCURRENCY STRESS ON /api/vitals/history
  // ============================================================================
  console.log("\n--- Section 4: Concurrency Stress on /api/vitals/history ---");

  await test("4.1 20 simultaneous concurrent GET requests for existing process (pmmanager-web)", async () => {
    const CONCURRENCY = 20;
    const requests = Array.from({ length: CONCURRENCY }, () => {
      const req = new NextRequest(
        "http://localhost:3000/api/vitals/history?process=pmmanager-web&hours=24",
        { headers: { "x-mock-role": "admin" } }
      );
      return vitalsHistoryGet(req);
    });

    const results = await Promise.all(requests);
    assert.strictEqual(results.length, CONCURRENCY);

    for (const res of results) {
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.process, "pmmanager-web");
      assert.ok(json.data.length > 0);
    }
  });

  await test("4.2 20 simultaneous concurrent GET requests for non-existent process (zero DB growth)", async () => {
    const CONCURRENCY = 20;
    const ghostProc = "concurrent_ghost_process_test";
    const totalBefore = getTotalVitalsCount();

    const requests = Array.from({ length: CONCURRENCY }, () => {
      const req = new NextRequest(
        `http://localhost:3000/api/vitals/history?process=${ghostProc}&hours=12`,
        { headers: { "x-mock-role": "admin" } }
      );
      return vitalsHistoryGet(req);
    });

    const results = await Promise.all(requests);
    assert.strictEqual(results.length, CONCURRENCY);

    for (const res of results) {
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.length, 0);
    }

    const totalAfter = getTotalVitalsCount();
    assert.strictEqual(totalAfter, totalBefore, "20 concurrent requests for non-existent process must yield 0 DB writes");
  });

  await test("4.3 50 mixed concurrent queries (valid processes, ghost processes, SQLi, extreme hours)", async () => {
    const CONCURRENCY = 50;
    const queries = [
      "?process=pmmanager-web&hours=24",
      "?process=web-app&hours=12",
      "?process=api-server&hours=6",
      "?process=ghost_1&hours=24",
      "?process=ghost_2&hours=-5",
      "?process=ghost_3&hours=100000",
      "?process=' OR 1=1--&hours=24",
      "?process=pmmanager-web&hours=invalid",
      "?process=unknown_proc_99&hours=0",
      "?hours=24",
    ];

    const startTotal = getTotalVitalsCount();
    const latencies: number[] = [];

    const tasks = Array.from({ length: CONCURRENCY }, async (_, idx) => {
      const queryStr = queries[idx % queries.length];
      const req = new NextRequest(
        `http://localhost:3000/api/vitals/history${queryStr}`,
        { headers: { "x-mock-role": idx % 2 === 0 ? "admin" : "developer" } }
      );
      const t0 = Date.now();
      const res = await vitalsHistoryGet(req);
      latencies.push(Date.now() - t0);

      assert.strictEqual(res.status, 200, `Task ${idx} with query ${queryStr} failed`);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(Array.isArray(json.data));
    });

    await Promise.all(tasks);

    const endTotal = getTotalVitalsCount();
    assert.strictEqual(endTotal, startTotal, "Mixed 50-request concurrency barrage must not mutate SQLite");

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const max = latencies[latencies.length - 1];
    console.log(`    Concurrency telemetry (50 requests): p50=${p50}ms, p95=${p95}ms, max=${max}ms`);
  });

  await test("4.4 100 rapid concurrent requests burst test with zero SQLITE_BUSY locking errors", async () => {
    const CONCURRENCY = 100;
    const errors: any[] = [];
    const t0 = Date.now();

    const tasks = Array.from({ length: CONCURRENCY }, async (_, idx) => {
      try {
        const req = new NextRequest(
          `http://localhost:3000/api/vitals/history?process=pmmanager-web&hours=${(idx % 48) + 1}`,
          { headers: { "x-mock-role": "admin" } }
        );
        const res = await vitalsHistoryGet(req);
        assert.strictEqual(res.status, 200);
        const json = await res.json();
        assert.strictEqual(json.success, true);
      } catch (err) {
        errors.push(err);
      }
    });

    await Promise.all(tasks);
    const totalDuration = Date.now() - t0;
    console.log(`    Burst 100 requests finished in ${totalDuration}ms (avg ${(totalDuration / CONCURRENCY).toFixed(2)}ms/req)`);

    assert.strictEqual(errors.length, 0, `Zero errors allowed during 100-request burst (got ${errors.length})`);
  });

  // ============================================================================
  // SECTION 5: HTTP METHOD GUARDS & SECURITY CONTROLS
  // ============================================================================
  console.log("\n--- Section 5: HTTP Method Guards & Authentication Controls ---");

  await test("5.1 Rejects unauthenticated request with 401 Unauthorized", async () => {
    const req = new NextRequest("http://localhost:3000/api/vitals/history", {
      headers: { "x-mock-role": "unauthenticated" },
    });
    const res = await vitalsHistoryGet(req);
    assert.strictEqual(res.status, 401);
  });

  await test("5.2 Rejects POST, PUT, DELETE with 405 Method Not Allowed", async () => {
    const resPost = await vitalsHistoryPost();
    assert.strictEqual(resPost.status, 405);

    const resPut = await vitalsHistoryPut();
    assert.strictEqual(resPut.status, 405);

    const resDelete = await vitalsHistoryDelete();
    assert.strictEqual(resDelete.status, 405);
  });

  // ============================================================================
  // SECTION 6: DIRECT SQLITE HELPER FUNCTION STRESS
  // ============================================================================
  console.log("\n--- Section 6: Direct SQLite Helper Function Stress ---");

  await test("6.1 getVitalsHistory handles direct negative, zero, astronomical hours without unhandled throw", () => {
    const resNeg = getVitalsHistory("pmmanager-web", -50);
    assert.ok(Array.isArray(resNeg));

    const resZero = getVitalsHistory("pmmanager-web", 0);
    assert.ok(Array.isArray(resZero));

    const resLarge = getVitalsHistory("pmmanager-web", 100000);
    assert.ok(Array.isArray(resLarge));

    const resExtreme = getVitalsHistory("pmmanager-web", 1e15);
    assert.ok(Array.isArray(resExtreme)); // returns [] safely on RangeError
  });

  await test("6.2 getVitalsHistory with non-existent process returns empty array without throwing", () => {
    const res = getVitalsHistory("totally_unheard_of_process_xyz", 24);
    assert.ok(Array.isArray(res));
    assert.strictEqual(res.length, 0);
  });

  await test("6.3 getVitalsHistory handles SQL injection strings as literal parameters", () => {
    const res = getVitalsHistory("' OR 1=1 --", 24);
    assert.ok(Array.isArray(res));
    assert.strictEqual(res.length, 0);

    const res2 = getVitalsHistory("; DROP TABLE pm2_vitals; --", 24);
    assert.ok(Array.isArray(res2));
    assert.strictEqual(res2.length, 0);
  });

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log("\n================================================================================");
  console.log(` Milestone 9 Challenger Gen 3 Results: ${stats.passed}/${stats.total} Passed (${stats.failed} Failed)`);
  console.log("================================================================================");

  if (stats.failed > 0) {
    console.error(`\nGATE VERDICT: REJECT - ${stats.failed} tests failed:`);
    for (const err of stats.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  } else {
    console.log("\nGATE VERDICT: APPROVE - All adversarial tests passed with 100% success.");
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("FATAL TEST HARNESS ERROR:", err);
  process.exit(1);
});
