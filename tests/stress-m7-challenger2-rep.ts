/**
 * Challenger 2 Replacement: Milestone 7 Real-Time Log Streamer (SSE)
 * Comprehensive Empirical Verification, Stress & Security Harness
 *
 * Requirements Tested:
 * 1. Query parameter validation:
 *    - Non-numeric lines parameter (?lines=abc, NaN, -50, 99999)
 *    - Process parameter with nonexistent processes (?process=nonexistent_app)
 *    - Special characters & shell metacharacter injection in ?process
 * 2. Connection endurance: maintain active SSE stream for 5+ seconds, asserting
 *    continuous delivery of valid formatted JSON event data.
 * 3. Rapid reconnection test: open and close 10 SSE connections in quick succession
 *    verifying clean socket tear-down without socket exhaustion or memory leaks.
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { GET as streamRouteGet } from "../src/app/api/pm2/logs/stream/route";
import { LogEvent } from "../src/lib/log-stream-service";

interface TestFinding {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  category: string;
  description: string;
  evidence: any;
}

const findings: TestFinding[] = [];

function parseSseChunks(buffer: string): { events: LogEvent[]; remainder: string } {
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() || "";
  const events: LogEvent[] = [];

  for (const part of parts) {
    const match = part.match(/data:\s*(\{.*?\})/s);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        events.push(parsed);
      } catch {
        // ignore incomplete
      }
    }
  }

  return { events, remainder };
}

async function main() {
  console.log("===============================================================================");
  console.log(" Milestone 7 Challenger 2 Replacement: Empirical Stability & Security Harness ");
  console.log("===============================================================================\n");

  let passed = 0;
  let failed = 0;

  async function it(name: string, fn: () => Promise<void>) {
    const t0 = Date.now();
    try {
      await fn();
      const durationMs = Date.now() - t0;
      console.log(`  ✓ [PASS] ${name} (${durationMs}ms)`);
      passed++;
    } catch (err: any) {
      const durationMs = Date.now() - t0;
      console.error(`  ✗ [FAIL] ${name} (${durationMs}ms)`);
      console.error(`     Error: ${err.message || String(err)}`);
      failed++;
    }
  }

  // =========================================================================
  // Section 1: Query Parameter Validation & Special Character Handling
  // =========================================================================
  console.log("--- Section 1: Query Parameter Validation & Boundary Handling ---");

  await it("1.1: Non-numeric lines parameter (?lines=abc) falls back gracefully without unhandled exception", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?lines=abc");
    const res = await streamRouteGet(req);

    assert.strictEqual(res.status, 200, "Should return HTTP 200");
    assert.strictEqual(res.headers.get("content-type"), "text/event-stream; charset=utf-8");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value, done } = await reader.read();
    await reader.cancel();

    assert.ok(!done && value, "Must receive initial chunk");
    const text = decoder.decode(value);
    const { events } = parseSseChunks(text + "\n\n");
    assert.ok(events.length >= 1, "Must emit at least initial handshake event");
    assert.strictEqual(events[0].type, "stdout");
  });

  await it("1.2: Extreme & invalid ?lines boundary parameters (?lines=-50, ?lines=0, ?lines=99999, ?lines=NaN)", async () => {
    const cases = [
      { val: "-50", desc: "clamped to 0 minimum" },
      { val: "0", desc: "0 historical lines" },
      { val: "99999", desc: "clamped to 100 maximum" },
      { val: "NaN", desc: "fallback to default" },
      { val: "Infinity", desc: "fallback to default" },
      { val: "0x10", desc: "hex string fallback" },
    ];

    for (const c of cases) {
      const req = new Request(`http://localhost:3000/api/pm2/logs/stream?lines=${c.val}`);
      const res = await streamRouteGet(req);
      assert.strictEqual(res.status, 200, `Status failed for ?lines=${c.val}`);
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      await reader.cancel();
      assert.ok(value, `Missing output for ?lines=${c.val}`);
    }
  });

  await it("1.3: Nonexistent process query parameter (?process=nonexistent_app) emits valid handshake safely", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?process=nonexistent_app&lines=0");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    await reader.cancel();

    const text = decoder.decode(value);
    const { events } = parseSseChunks(text + "\n\n");
    assert.ok(events.length >= 1, "Must emit initial handshake event");
    assert.strictEqual(events[0].process, "nonexistent_app");
    assert.ok(events[0].message.includes("nonexistent_app"));
  });

  await it("1.4: Special characters & shell command injection in ?process parameter (Adversarial Security Probe)", async () => {
    const proofFile = path.join(process.cwd(), "challenger_rce_proof.txt");
    if (fs.existsSync(proofFile)) {
      try { fs.unlinkSync(proofFile); } catch {}
    }

    // Attempt command injection via shell separator '&'
    const injectionCmd = `app & echo VULNERABLE_RCE > "${proofFile}" &`;
    const req = new Request(`http://localhost:3000/api/pm2/logs/stream?process=${encodeURIComponent(injectionCmd)}&lines=0`);
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const reader = res.body!.getReader();
    const start = Date.now();
    while (Date.now() - start < 3000) {
      const timeout = new Promise<{ done: boolean; value?: Uint8Array }>((r) => setTimeout(() => r({ done: false }), 500));
      const { done } = await Promise.race([reader.read(), timeout]);
      if (done || fs.existsSync(proofFile)) break;
    }
    await reader.cancel();

    const rceExecuted = fs.existsSync(proofFile);
    if (rceExecuted) {
      const content = fs.readFileSync(proofFile, "utf8").trim();
      try { fs.unlinkSync(proofFile); } catch {}

      findings.push({
        severity: "CRITICAL",
        category: "Remote Code Execution / Host Command Injection",
        description: "The ?process query parameter is passed unsanitized to child_process.spawn('pm2', ..., { shell: true }) on Windows, executing arbitrary host shell commands.",
        evidence: {
          injectedPayload: injectionCmd,
          createdFile: proofFile,
          fileContent: content,
          vulnerableLine: "src/lib/log-stream-service.ts:304-307",
        },
      });

      console.warn(`    ⚠️ CRITICAL VULNERABILITY REPRODUCED: Arbitrary host command executed! File created with content: "${content}"`);
    } else {
      console.log("    ✓ Host command did not execute.");
    }
  });

  // =========================================================================
  // Section 2: Connection Endurance Test (5+ Seconds Continuous Stream)
  // =========================================================================
  console.log("\n--- Section 2: Connection Endurance Test (5 Seconds Continuous Stream) ---");

  await it("2.1: Maintain active SSE stream for 5 seconds with continuous valid JSON event delivery", async () => {
    const memBefore = process.memoryUsage();
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?process=endurance-test&lines=0");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const events: LogEvent[] = [];
    const eventTimes: number[] = [];
    let rawBuffer = "";
    const startTime = Date.now();
    const TARGET_DURATION_MS = 5200; // 5.2 seconds

    while (Date.now() - startTime < TARGET_DURATION_MS) {
      const timeoutPromise = new Promise<{ done: boolean; value?: Uint8Array }>((resolve) =>
        setTimeout(() => resolve({ done: false }), 2200)
      );
      const chunk = await Promise.race([reader.read(), timeoutPromise]);
      if (chunk.done) break;

      if (chunk.value) {
        rawBuffer += decoder.decode(chunk.value, { stream: true });
        const parsed = parseSseChunks(rawBuffer);
        rawBuffer = parsed.remainder;
        for (const evt of parsed.events) {
          events.push(evt);
          eventTimes.push(Date.now() - startTime);
        }
      }
    }

    const elapsed = Date.now() - startTime;
    await reader.cancel();

    const memAfter = process.memoryUsage();
    const heapDiffMb = (memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024);

    console.log(`    Active endurance duration: ${elapsed}ms`);
    console.log(`    Total valid JSON events received: ${events.length}`);
    console.log(`    Event delivery timestamps: ${eventTimes.map(t => `${t}ms`).join(", ")}`);
    console.log(`    Heap memory diff: ${heapDiffMb.toFixed(3)} MB`);

    // Verification
    assert.ok(elapsed >= 5000, `Endurance run terminated early: ${elapsed}ms < 5000ms`);
    assert.ok(events.length >= 3, `Expected >= 3 events over 5.2s, received ${events.length}`);

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      assert.ok(typeof e.timestamp === "string" && !isNaN(Date.parse(e.timestamp)), `Event ${i} bad timestamp`);
      assert.ok(typeof e.process === "string" && e.process.length > 0, `Event ${i} bad process`);
      assert.ok(e.type === "stdout" || e.type === "stderr" || e.type === "system", `Event ${i} bad type`);
      assert.ok(typeof e.message === "string" && e.message.length > 0, `Event ${i} bad message`);
    }

    assert.ok(heapDiffMb < 35, `Excessive heap accumulation: ${heapDiffMb.toFixed(2)} MB`);
  });

  // =========================================================================
  // Section 3: Rapid Reconnection Test (10 Connections in Quick Succession)
  // =========================================================================
  console.log("\n--- Section 3: Rapid Reconnection & Socket Churn Test ---");

  await it("3.1: Sequential rapid reconnection (10 connections opened, handshake read, immediately closed)", async () => {
    const ITERATIONS = 10;
    const memBefore = process.memoryUsage();
    const startT = Date.now();

    for (let i = 1; i <= ITERATIONS; i++) {
      const abortCtrl = new AbortController();
      const req = new Request(`http://localhost:3000/api/pm2/logs/stream?process=churn-seq-${i}&lines=0`, {
        signal: abortCtrl.signal,
      });

      const res = await streamRouteGet(req);
      assert.strictEqual(res.status, 200);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const { value, done } = await reader.read();
      assert.ok(!done && value);

      const text = decoder.decode(value);
      assert.ok(text.includes(`churn-seq-${i}`));

      abortCtrl.abort();
      await reader.cancel();
    }

    const elapsed = Date.now() - startT;
    const memAfter = process.memoryUsage();
    const heapDiffMb = (memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024);

    console.log(`    Sequential 10 connections opened & closed in ${elapsed}ms`);
    console.log(`    Heap diff: ${heapDiffMb.toFixed(3)} MB`);
    assert.ok(heapDiffMb < 25);
  });

  await it("3.2: Concurrent rapid reconnection (10 connections opened simultaneously, read, aborted)", async () => {
    const CONCURRENT_COUNT = 10;
    const memBefore = process.memoryUsage();
    const startT = Date.now();

    const tasks = Array.from({ length: CONCURRENT_COUNT }).map(async (_, idx) => {
      const abortCtrl = new AbortController();
      const req = new Request(`http://localhost:3000/api/pm2/logs/stream?process=concurrent-${idx}&lines=0`, {
        signal: abortCtrl.signal,
      });
      const res = await streamRouteGet(req);
      assert.strictEqual(res.status, 200);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const { value, done } = await reader.read();
      assert.ok(!done && value);

      const text = decoder.decode(value);
      assert.ok(text.includes(`concurrent-${idx}`));

      abortCtrl.abort();
      await reader.cancel();
      return idx;
    });

    const results = await Promise.all(tasks);
    assert.strictEqual(results.length, CONCURRENT_COUNT);

    const elapsed = Date.now() - startT;
    const memAfter = process.memoryUsage();
    const heapDiffMb = (memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024);

    console.log(`    Concurrent 10 connections completed in ${elapsed}ms`);
    console.log(`    Heap diff: ${heapDiffMb.toFixed(3)} MB`);
    assert.ok(heapDiffMb < 30);
  });

  await it("3.3: Rapid abort before any read (10 connections aborted immediately at creation)", async () => {
    for (let i = 0; i < 10; i++) {
      const abortCtrl = new AbortController();
      const req = new Request(`http://localhost:3000/api/pm2/logs/stream?process=immediate-abort-${i}`, {
        signal: abortCtrl.signal,
      });
      abortCtrl.abort();
      const res = await streamRouteGet(req);
      assert.strictEqual(res.status, 200);
      if (res.body) {
        const reader = res.body.getReader();
        try { await reader.cancel(); } catch {}
      }
    }
  });

  await it("3.4: Server remains fully responsive after connection churn", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?process=post-churn-health&lines=2");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value, done } = await reader.read();
    await reader.cancel();

    assert.ok(!done && value);
    const text = decoder.decode(value);
    assert.ok(text.includes("post-churn-health"));
  });

  // =========================================================================
  // Test Summary & Findings
  // =========================================================================
  console.log("\n===============================================================================");
  console.log(` Challenger 2 Replacement Test Summary: ${passed} Passed, ${failed} Failed`);
  console.log(` Security & Stability Findings: ${findings.length}`);
  for (const f of findings) {
    console.log(`  [${f.severity}] ${f.category}: ${f.description}`);
  }
  console.log("===============================================================================\n");

  // Clean up any test artifacts if any
  const leftoverProof = path.join(process.cwd(), "challenger_rce_proof.txt");
  if (fs.existsSync(leftoverProof)) {
    try { fs.unlinkSync(leftoverProof); } catch {}
  }

  // If there are CRITICAL security findings or failed tests, exit with error
  if (findings.some((f) => f.severity === "CRITICAL") || failed > 0) {
    process.exit(2);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error in test harness:", err);
  process.exit(1);
});
