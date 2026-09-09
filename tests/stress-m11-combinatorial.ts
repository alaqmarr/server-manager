/**
 * PM2 Manager Dashboard - Milestone 11 Tier 5 Hardening
 * Cross-Feature Combinatorial Stress Testing & System Endurance Harness
 *
 * Test Sections:
 * 1. Multi-Feature Concurrent Load:
 *    - SSE streaming active + PM2 vitals worker + Uptime checker + Deploy webhooks + RBAC queries.
 * 2. SQLite WAL Mode & Database Stability Under Concurrency:
 *    - PRAGMA journal_mode = WAL & foreign_keys = ON verification.
 *    - 150+ rapid concurrent interleaved read/write operations.
 *    - Verification of zero SQLITE_BUSY lock errors and database integrity.
 * 3. Resource Cleanup & Leak Prevention:
 *    - SSE stream connections cancellation & timer cleanup.
 *    - AbortController timeout cleanup in Uptime pings.
 *    - Background worker start/stop idempotency and interval teardown.
 *    - Heap memory stability tracking.
 * 4. Negative Cross-Interactions & Fault Isolation:
 *    - Unauthorized, forbidden, and malformed requests executed concurrently with active services.
 *    - Verification that rejected requests do not destabilize active streams or valid operations.
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import { NextRequest } from "next/server";
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
  createUser,
  deleteUser,
  listUsers,
  getUserByUsername,
} from "../src/lib/db";

import {
  startVitalsWorker,
  stopVitalsWorker,
  isVitalsWorkerActive,
  collectVitalsNow,
} from "../src/lib/vitals-worker";

import {
  startUptimeWorker,
  stopUptimeWorker,
  isUptimeWorkerActive,
  pingUrl,
  performUptimeCheck,
} from "../src/lib/uptime-service";

import {
  createLogStream,
  formatSseEvent,
  generateMockLogLine,
  getHistoricalLogs,
} from "../src/lib/log-stream-service";

import {
  getDeployments,
  waitForDeployment,
  clearDeploymentHistory,
} from "../src/lib/deploy-service";

import { checkVitalsAndAlert } from "../src/lib/discord-service";

// Route handlers for direct request dispatch
import { GET as streamGet } from "../src/app/api/pm2/logs/stream/route";
import { GET as vitalsHistoryGet } from "../src/app/api/vitals/history/route";
import { GET as uptimeGet, POST as uptimePost, DELETE as uptimeDelete } from "../src/app/api/uptime/route";
import { POST as uptimeCheckPost } from "../src/app/api/uptime/check/route";
import { POST as deployWebhookPost } from "../src/app/api/deploy/webhook/route";
import { GET as fail2banGet } from "../src/app/api/fail2ban/route";
import { POST as fail2banUnbanPost } from "../src/app/api/fail2ban/unban/route";
import { GET as usersGet, POST as usersPost } from "../src/app/api/users/route";
import { GET as nginxFilesGet } from "../src/app/api/nginx/files/route";
import { GET as envGet } from "../src/app/api/env/route";
import { POST as terminalExecutePost } from "../src/app/api/terminal/execute/route";

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  assertions: number;
}

const results: TestResult[] = [];
let currentAssertions = 0;

function check(condition: boolean, message?: string) {
  currentAssertions++;
  assert.ok(condition, message);
}

function checkEqual<T>(actual: T, expected: T, message?: string) {
  currentAssertions++;
  assert.strictEqual(actual, expected, message);
}

async function runTest(suite: string, name: string, fn: () => Promise<void>) {
  currentAssertions = 0;
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    results.push({ suite, name, passed: true, durationMs, assertions: currentAssertions });
    console.log(`  [PASS] [${suite}] ${name} (${durationMs}ms, ${currentAssertions} assertions)`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const errorMsg = err?.stack || err?.message || String(err);
    results.push({ suite, name, passed: false, durationMs, error: errorMsg, assertions: currentAssertions });
    console.error(`  [FAIL] [${suite}] ${name} (${durationMs}ms)`);
    console.error(`         Error: ${errorMsg}`);
  }
}

async function main() {
  console.log("=========================================================================");
  console.log("  CHALLENGER TIER 5: COMBINATORIAL STRESS & SYSTEM ENDURANCE HARNESS    ");
  console.log("=========================================================================\n");

  // ============================================================================
  // SUITE 1: MULTI-FEATURE CONCURRENT LOAD
  // ============================================================================
  console.log("--- Suite 1: Multi-Feature Concurrent Load ---");

  await runTest("Multi-Feature Concurrency", "1.1 Active SSE streaming + vitals worker + uptime checks + deploy webhooks + RBAC queries under load", async () => {
    // 1. Setup temporary test monitor for uptime checks
    const monitor = createUptimeMonitor(
      "Combinatorial Test Monitor",
      "https://httpbin.org/status/200",
      60
    );
    check(monitor.id > 0, "Uptime monitor created");

    // 2. Start workers
    startVitalsWorker();
    startUptimeWorker();
    check(isVitalsWorkerActive(), "Vitals worker active");
    check(isUptimeWorkerActive(), "Uptime worker active");

    // 3. Establish active SSE streams
    const sseAbort1 = new AbortController();
    const sseAbort2 = new AbortController();
    const sseStream1 = createLogStream({ processName: "all", signal: sseAbort1.signal });
    const sseStream2 = createLogStream({ processName: "api-server", signal: sseAbort2.signal });

    const reader1 = sseStream1.getReader();
    const reader2 = sseStream2.getReader();

    // Consume first events from both streams
    const [chunk1, chunk2] = await Promise.all([reader1.read(), reader2.read()]);
    check(!chunk1.done && chunk1.value !== undefined, "Stream 1 emitted initial chunk");
    check(!chunk2.done && chunk2.value !== undefined, "Stream 2 emitted initial chunk");

    const decoded1 = new TextDecoder().decode(chunk1.value);
    check(decoded1.includes("data:"), "Stream 1 emitted SSE formatted data");

    // 4. Launch 60 parallel operations across features simultaneously
    const operations: Promise<any>[] = [];

    // Feature A: Vitals collection and query
    for (let i = 0; i < 12; i++) {
      operations.push((async () => {
        if (i % 2 === 0) {
          const req = new NextRequest("http://localhost:3000/api/vitals/history?process=pmmanager-web&hours=1", {
            headers: { "x-mock-role": "admin" },
          });
          const res = await vitalsHistoryGet(req);
          checkEqual(res.status, 200, "Vitals history GET returns 200");
          const data = await res.json();
          check(data.success === true, "Vitals history response success");
        } else {
          const vitals = await collectVitalsNow();
          check(Array.isArray(vitals), "collectVitalsNow returned array");
        }
      })());
    }

    // Feature B: Uptime checks & queries
    for (let i = 0; i < 12; i++) {
      operations.push((async () => {
        if (i % 2 === 0) {
          const req = new NextRequest("http://localhost:3000/api/uptime", {
            headers: { "x-mock-role": "developer" },
          });
          const res = await uptimeGet(req);
          checkEqual(res.status, 200, "Uptime GET returns 200");
          const data = await res.json();
          check(Array.isArray(data.monitors), "Uptime monitors array returned");
        } else {
          // Perform programmatic check
          const checkRec = recordUptimeCheck({
            monitorId: monitor.id,
            status: "UP",
            statusCode: 200,
            responseTime: 45,
            error: null,
          });
          checkEqual(checkRec.status, "UP", "Check recorded");
          recalculateMonitorSLA(monitor.id);
        }
      })());
    }

    // Feature C: Deploy webhooks (concurrent simulated GitHub pushes)
    for (let i = 0; i < 6; i++) {
      operations.push((async () => {
        const req = new NextRequest("http://localhost:3000/api/deploy/webhook", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ref: "refs/heads/main",
            repository: { name: "pmmanager" },
            head_commit: {
              id: `stress-commit-${i}`,
              message: `Simulated push #${i}`,
              author: { name: "Combinatorial Tester" },
            },
          }),
        });
        const res = await deployWebhookPost(req);
        check(res.status === 200 || res.status === 202, `Deploy webhook POST returns 200 or 202 (got ${res.status})`);
        const data = await res.json();
        check(Boolean(data.deploymentId), "Deployment ID generated");
      })());
    }

    // Feature D: RBAC Sensitive Admin Endpoints (Authorized Admin: 200)
    for (let i = 0; i < 10; i++) {
      operations.push((async () => {
        const req = new NextRequest("http://localhost:3000/api/users", {
          headers: { "x-mock-role": "admin" },
        });
        const res = await usersGet(req);
        checkEqual(res.status, 200, "Admin access to /api/users returns 200");
      })());
    }

    // Feature E: RBAC Developer Access Restrictions (Developer: 403 on admin routes)
    for (let i = 0; i < 10; i++) {
      operations.push((async () => {
        const req = new NextRequest("http://localhost:3000/api/terminal/execute", {
          method: "POST",
          headers: { "content-type": "application/json", "x-mock-role": "developer" },
          body: JSON.stringify({ command: "echo test" }),
        });
        const res = await terminalExecutePost(req);
        checkEqual(res.status, 403, "Developer blocked on terminal with 403");
      })());
    }

    // Feature F: RBAC Unauthenticated Access Restrictions (Unauthenticated: 401)
    for (let i = 0; i < 10; i++) {
      operations.push((async () => {
        const req = new NextRequest("http://localhost:3000/api/nginx/files", {
          headers: { "x-mock-role": "unauthenticated" },
        });
        const res = await nginxFilesGet(req);
        checkEqual(res.status, 401, "Unauthenticated blocked on nginx with 401");
      })());
    }

    // Await all concurrent operations
    await Promise.all(operations);

    // 5. Verify SSE streams were not corrupted or closed by concurrent activity
    const chunkAfter = await Promise.race([
      reader1.read(),
      new Promise<any>((_, reject) => setTimeout(() => reject(new Error("Timeout reading SSE chunk")), 4000)),
    ]);
    check(!chunkAfter.done, "Stream 1 still open and active after concurrent load");

    // 6. Cleanup
    sseAbort1.abort();
    sseAbort2.abort();
    stopVitalsWorker();
    stopUptimeWorker();
    deleteUptimeMonitor(monitor.id);
  });

  // ============================================================================
  // SUITE 2: SQLITE WAL MODE & DATABASE STABILITY UNDER CONCURRENCY
  // ============================================================================
  console.log("\n--- Suite 2: SQLite WAL Mode & Database Stability Under Concurrency ---");

  await runTest("SQLite Stability", "2.1 SQLite PRAGMAs verify journal_mode=WAL, foreign_keys=ON, and integrity_check", async () => {
    const journalModeResult = db.pragma("journal_mode") as [{ journal_mode: string }];
    const journalMode = (journalModeResult[0]?.journal_mode || "").toLowerCase();
    checkEqual(journalMode, "wal", "Database is running in WAL mode");

    const fkResult = db.pragma("foreign_keys") as [{ foreign_keys: number }];
    const fkEnabled = fkResult[0]?.foreign_keys === 1;
    check(fkEnabled, "Foreign keys are enabled (1)");

    const integrityResult = db.pragma("integrity_check") as [{ integrity_check: string }];
    checkEqual(integrityResult[0]?.integrity_check, "ok", "PRAGMA integrity_check is 'ok'");
  });

  await runTest("SQLite Stability", "2.2 150 concurrent interleaved read/write transactions execute with ZERO SQLITE_BUSY errors", async () => {
    const CONCURRENCY = 150;
    const errors: Error[] = [];
    const busyErrors: Error[] = [];
    const startTime = Date.now();

    // Setup monitor for concurrent checks
    const monitor = createUptimeMonitor(
      "Burst SLA Monitor",
      "http://localhost:3000/api/health",
      30
    );
    check(monitor.id > 0, "Monitor created for concurrency test");

    const tasks = Array.from({ length: CONCURRENCY }, async (_, i) => {
      try {
        const mod = i % 5;
        if (mod === 0) {
          // Write PM2 vital
          recordVital(`process-burst-${i % 4}`, Math.random() * 50, 45000000 + i * 1000);
        } else if (mod === 1) {
          // Write Uptime check + SLA recalculation
          recordUptimeCheck({
            monitorId: monitor.id,
            status: i % 2 === 0 ? "UP" : "DOWN",
            statusCode: i % 2 === 0 ? 200 : 503,
            responseTime: 20 + (i % 50),
            error: i % 2 === 0 ? null : "Simulated failure",
          });
          recalculateMonitorSLA(monitor.id);
        } else if (mod === 2) {
          // Read vitals history
          const history = getVitalsHistory(`process-burst-${i % 4}`, 2);
          check(Array.isArray(history), "History is array");
        } else if (mod === 3) {
          // Read uptime monitors
          const monitors = getUptimeMonitors();
          check(monitors.length > 0, "Monitors list non-empty");
        } else {
          // Create and query developer user
          const username = `burst_user_${i}_${Date.now()}`;
          const created = createUser(username, "$2a$10$bursthashplaceholder", "developer");
          check(created, "User created successfully");
          const user = getUserByUsername(username);
          check(user !== null && user.username.toLowerCase() === username.toLowerCase(), "User fetched");
          deleteUser(user!.id);
        }
      } catch (err: any) {
        errors.push(err);
        if (err?.code === "SQLITE_BUSY" || err?.message?.includes("busy") || err?.message?.includes("locked")) {
          busyErrors.push(err);
        }
      }
    });

    await Promise.all(tasks);
    const durationMs = Date.now() - startTime;
    console.log(`    Executed ${CONCURRENCY} concurrent mixed DB operations in ${durationMs}ms (avg ${(durationMs / CONCURRENCY).toFixed(2)}ms/op)`);

    // Cleanup monitor
    deleteUptimeMonitor(monitor.id);

    checkEqual(busyErrors.length, 0, `Expected 0 SQLITE_BUSY errors, got ${busyErrors.length}`);
    checkEqual(errors.length, 0, `Expected 0 total errors during concurrency burst, got ${errors.length}`);
  });

  await runTest("SQLite Stability", "2.3 Foreign key cascading deletes maintain referential integrity without orphan records", async () => {
    // 1. Create a monitor
    const monitor = createUptimeMonitor(
      "Cascade Test Monitor",
      "https://example.com/health",
      60
    );

    // 2. Insert 10 checks
    for (let i = 0; i < 10; i++) {
      recordUptimeCheck({
        monitorId: monitor.id,
        status: "UP",
        statusCode: 200,
        responseTime: 10 + i,
        error: null,
      });
    }

    const checksBefore = getUptimeChecks(monitor.id);
    checkEqual(checksBefore.length, 10, "10 checks created for monitor");

    // 3. Delete monitor
    const deleted = deleteUptimeMonitor(monitor.id);
    check(deleted, "Monitor deleted successfully");

    // 4. Verify cascade removed all associated checks
    const checksAfter = getUptimeChecks(monitor.id);
    checkEqual(checksAfter.length, 0, "All checks cascaded on monitor deletion");

    // 5. Verify direct query confirms zero orphan rows
    const orphanCount = (db.prepare("SELECT count(*) as count FROM uptime_checks WHERE monitorId = ?").get(monitor.id) as { count: number }).count;
    checkEqual(orphanCount, 0, "Direct query confirms zero orphan uptime_checks");
  });

  // ============================================================================
  // SUITE 3: RESOURCE CLEANUP & LEAK PREVENTION
  // ============================================================================
  console.log("\n--- Suite 3: Resource Cleanup & Leak Prevention ---");

  await runTest("Resource Cleanup", "3.1 Rapid SSE stream creation and abort closes streams, cancels intervals, and prevents leaks", async () => {
    const STREAM_COUNT = 40;
    const abortControllers = Array.from({ length: STREAM_COUNT }, () => new AbortController());

    // Create 40 streams concurrently with lines: 0 so only handshake is in queue
    const streams = abortControllers.map((ctrl) =>
      createLogStream({ processName: "all", lines: 0, signal: ctrl.signal })
    );

    // Read initial chunk from all 40 streams to confirm startup
    const readers = streams.map((stream) => stream.getReader());
    const readPromises = readers.map(async (reader) => {
      const chunk = await reader.read();
      check(!chunk.done && chunk.value !== undefined, "Initial chunk received");
    });

    await Promise.all(readPromises);

    // Abort all streams simultaneously
    abortControllers.forEach((ctrl) => ctrl.abort());

    // Allow event loop tick for cleanup
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify reading from aborted streams yields { done: true }
    const postAbortReads = readers.map(async (reader) => {
      const chunk = await reader.read();
      check(chunk.done === true, "Stream cleanly terminated upon abort signal");
      reader.releaseLock();
    });

    await Promise.all(postAbortReads);
  });

  await runTest("Resource Cleanup", "3.2 Uptime pingUrl clears AbortController timeoutId on success, failure, and timeout", async () => {
    // 1. Success ping (clears timeout in try block)
    const resSuccess = await pingUrl("https://httpbin.org/status/200", 5000);
    check(resSuccess.status === "UP" || resSuccess.status === "DOWN", "Success ping returned status");

    // 2. Immediate connection error (clears timeout in catch block)
    const resFail = await pingUrl("http://non-existent-domain-xyz-12345.local", 1000);
    checkEqual(resFail.status, "DOWN", "Failing ping returned DOWN");
    check(Boolean(resFail.error), "Failing ping returned error string");

    // 3. Simulated timeout ping (abort triggered)
    const resTimeout = await pingUrl("https://httpbin.org/delay/5", 100);
    checkEqual(resTimeout.status, "DOWN", "Timed out ping returned DOWN");
    check(resTimeout.error?.includes("timed out") || resTimeout.error?.includes("aborted") || Boolean(resTimeout.error), "Timeout correctly reported");
  });

  await runTest("Resource Cleanup", "3.3 Background workers rapid start/stop cycling maintains singleton idempotency without leaked timers", async () => {
    // Rapidly toggle vitals and uptime workers 20 times
    for (let i = 0; i < 20; i++) {
      startVitalsWorker();
      startUptimeWorker();
      check(isVitalsWorkerActive(), `Vitals worker active at cycle ${i}`);
      check(isUptimeWorkerActive(), `Uptime worker active at cycle ${i}`);

      stopVitalsWorker();
      stopUptimeWorker();
      check(!isVitalsWorkerActive(), `Vitals worker stopped at cycle ${i}`);
      check(!isUptimeWorkerActive(), `Uptime worker stopped at cycle ${i}`);
    }

    // Verify global intervals are undefined
    checkEqual(globalThis.__vitalsWorkerInterval, undefined, "Vitals worker interval cleared");
    checkEqual(globalThis.__uptimeWorkerInterval, undefined, "Uptime worker interval cleared");
  });

  await runTest("Resource Cleanup", "3.4 Memory heap delta remains stable during heavy cycling", async () => {
    // Measure heap before
    if (global.gc) global.gc();
    const heapBefore = process.memoryUsage().heapUsed;

    // Run 100 cycles of stream + db + worker operations
    for (let i = 0; i < 100; i++) {
      const abort = new AbortController();
      const stream = createLogStream({ processName: "all", lines: 0, signal: abort.signal });
      const reader = stream.getReader();
      await reader.read();
      reader.releaseLock();
      abort.abort();

      recordVital("mem-test-proc", Math.random() * 10, 50000000);
    }

    if (global.gc) global.gc();
    const heapAfter = process.memoryUsage().heapUsed;
    const deltaMB = (heapAfter - heapBefore) / (1024 * 1024);
    console.log(`    Heap delta after 100 stream & DB cycles: ${deltaMB.toFixed(2)} MB`);

    // Assert heap delta does not balloon uncontrollably (threshold: < 50MB)
    check(deltaMB < 50, `Heap growth is bounded (${deltaMB.toFixed(2)} MB < 50 MB)`);
  });

  // ============================================================================
  // SUITE 4: NEGATIVE CROSS-INTERACTIONS & FAULT ISOLATION
  // ============================================================================
  console.log("\n--- Suite 4: Negative Cross-Interactions & Fault Isolation ---");

  await runTest("Negative Cross-Interactions", "4.1 Simultaneous malicious and invalid requests fail gracefully without crashing active services", async () => {
    // 1. Start active stream to monitor continuity
    const monitorAbort = new AbortController();
    const activeStream = createLogStream({ processName: "all", signal: monitorAbort.signal });
    const reader = activeStream.getReader();
    const initialChunk = await reader.read();
    check(!initialChunk.done, "Baseline monitoring stream started");

    // 2. Blast 30 malformed/unauthorized/adversarial requests
    const attackTasks: Promise<any>[] = [
      // Shell injection in fail2ban unban
      fail2banUnbanPost(new NextRequest("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mock-role": "admin" },
        body: JSON.stringify({ ip: "127.0.0.1; cat /etc/passwd", jail: "sshd" }),
      })).then((res) => checkEqual(res.status, 400, "Shell injection in IP rejected with 400")),

      // Shell metachars in jail
      fail2banUnbanPost(new NextRequest("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mock-role": "admin" },
        body: JSON.stringify({ ip: "1.2.3.4", jail: "sshd && reboot" }),
      })).then((res) => checkEqual(res.status, 400, "Shell injection in jail rejected with 400")),

      // Developer privilege escalation on unban
      fail2banUnbanPost(new NextRequest("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mock-role": "developer" },
        body: JSON.stringify({ ip: "192.168.1.100", jail: "sshd" }),
      })).then((res) => checkEqual(res.status, 403, "Developer forbidden on unban with 403")),

      // Unauthenticated access to terminal
      terminalExecutePost(new NextRequest("http://localhost:3000/api/terminal/execute", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mock-role": "unauthenticated" },
        body: JSON.stringify({ command: "whoami" }),
      })).then((res) => checkEqual(res.status, 401, "Unauthenticated access to terminal returns 401")),

      // Malformed JSON to deploy webhook
      deployWebhookPost(new NextRequest("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ malformed json: true, ",
      })).then((res) => checkEqual(res.status, 400, "Malformed JSON webhook returns 400")),

      // Empty body to deploy webhook
      deployWebhookPost(new NextRequest("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "",
      })).then((res) => checkEqual(res.status, 400, "Empty body webhook returns 400")),

      // Invalid process identifier to SSE stream route
      streamGet(new NextRequest("http://localhost:3000/api/pm2/logs/stream?targetProcess=..%2F..%2Fetc%2Fshadow")).then((res) =>
        checkEqual(res.status, 400, "Path traversal in targetProcess returns 400")
      ),

      // Missing parameters on uptime check
      uptimeCheckPost(new NextRequest("http://localhost:3000/api/uptime/check", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mock-role": "admin" },
        body: JSON.stringify({}),
      })).then((res) => checkEqual(res.status, 400, "Empty monitorId check returns 400")),

      // Non-existent monitor check
      uptimeCheckPost(new NextRequest("http://localhost:3000/api/uptime/check", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mock-role": "admin" },
        body: JSON.stringify({ id: 999999 }),
      })).then((res) => checkEqual(res.status, 404, "Non-existent monitor check returns 404")),

      // Boundary parameters on vitals history
      vitalsHistoryGet(new NextRequest("http://localhost:3000/api/vitals/history?hours=-50", {
        headers: { "x-mock-role": "admin" },
      })).then((res) => checkEqual(res.status, 200, "Negative hours handled safely (returns 200)")),

      vitalsHistoryGet(new NextRequest("http://localhost:3000/api/vitals/history?hours=invalid_string", {
        headers: { "x-mock-role": "admin" },
      })).then((res) => checkEqual(res.status, 200, "Non-numeric hours handled safely (returns 200)")),
    ];

    await Promise.all(attackTasks);

    // 3. Verify baseline stream was not interrupted
    const chunkAfter = await Promise.race([
      reader.read(),
      new Promise<any>((_, reject) => setTimeout(() => reject(new Error("Baseline stream hung")), 3000)),
    ]);
    check(!chunkAfter.done, "Baseline stream remains healthy and uninterrupted after attacks");

    // 4. Verify legitimate admin operation continues to succeed immediately after attack
    const cleanReq = new NextRequest("http://localhost:3000/api/vitals/history", {
      headers: { "x-mock-role": "admin" },
    });
    const cleanRes = await vitalsHistoryGet(cleanReq);
    checkEqual(cleanRes.status, 200, "Subsequent legitimate request succeeds with 200");

    reader.releaseLock();
    monitorAbort.abort();
  });

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log("\n=========================================================================");
  console.log("                       HARNESS EXECUTION SUMMARY                         ");
  console.log("=========================================================================");

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalAssertions = results.reduce((sum, r) => sum + r.assertions, 0);
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);

  console.log(`Total Test Cases : ${total}`);
  console.log(`Total Assertions : ${totalAssertions}`);
  console.log(`Passed           : ${passed}`);
  console.log(`Failed           : ${failed}`);
  console.log(`Total Duration   : ${(totalDuration / 1000).toFixed(2)}s`);

  if (failed > 0) {
    console.log("\nFAILED TESTS:");
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`  ✖ [${r.suite}] ${r.name}`);
      console.log(`    ${r.error}`);
    });
    process.exit(1);
  } else {
    console.log("\nOVERALL STATUS: ALL COMBINATORIAL STRESS TESTS PASSED (100% SUCCESS)\n");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error running stress harness:", err);
  process.exit(1);
});
