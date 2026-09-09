/**
 * Adversarial Stress & Integrity Verification Harness for Milestone 7
 * Auditing: Real-Time Log Streamer (SSE)
 */

import assert from "node:assert";
import { GET as streamRouteGet } from "../src/app/api/pm2/logs/stream/route";
import { createLogStream, formatSseEvent, generateMockLogLine, getHistoricalLogs } from "../src/lib/log-stream-service";

async function runAdversarialAudit() {
  console.log("=== Starting Milestone 7 Adversarial Forensic Audit ===\n");
  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err: unknown) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  // 1. Extreme and Adversarial Query Parameters
  await test("Adversarial 1: Negative, extreme, and malformed 'lines' parameters", async () => {
    const testCases = ["lines=-100", "lines=999999", "lines=notanumber", "lines=0", "lines=50.5"];
    for (const tc of testCases) {
      const req = new Request(`http://localhost:3000/api/pm2/logs/stream?${tc}`);
      const res = await streamRouteGet(req);
      assert.strictEqual(res.status, 200, `Expected 200 for ${tc}`);
      const reader = res.body!.getReader();
      const { value, done } = await reader.read();
      assert.ok(!done);
      assert.ok(value);
      await reader.cancel();
    }
  });

  await test("Adversarial 2: Shell metacharacters and injection strings in 'process' parameter", async () => {
    const maliciousInputs = [
      "test; echo injected",
      "test & echo injected",
      "test | echo injected",
      "test`id`",
      "test$(whoami)",
      "../../../etc/passwd",
      "   ",
      "",
      "A".repeat(500),
    ];
    for (const input of maliciousInputs) {
      const req = new Request(
        `http://localhost:3000/api/pm2/logs/stream?process=${encodeURIComponent(input)}`
      );
      const res = await streamRouteGet(req);
      assert.strictEqual(res.status, 200, `Must return 200 without throwing for process='${input}'`);
      const reader = res.body!.getReader();
      const { value, done } = await reader.read();
      assert.ok(!done);
      assert.ok(value);
      await reader.cancel();
    }
  });

  // 2. High-Concurrency Connection & Abort Storm (Memory Leak Probe)
  await test("Adversarial 3: 100 concurrent SSE connections with staggered aborts", async () => {
    const CONCURRENCY = 100;
    const promises: Promise<void>[] = [];

    for (let i = 0; i < CONCURRENCY; i++) {
      promises.push(
        (async () => {
          const controller = new AbortController();
          const req = new Request(`http://localhost:3000/api/pm2/logs/stream?process=stress-${i}`, {
            signal: controller.signal,
          });
          const res = await streamRouteGet(req);
          assert.strictEqual(res.status, 200);

          const reader = res.body!.getReader();
          // Read the initial event
          const { value, done } = await reader.read();
          assert.ok(!done);
          assert.ok(value);

          // Staggered abort between 0ms and 50ms
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));
          controller.abort();

          try {
            await reader.cancel();
          } catch {}
        })()
      );
    }

    await Promise.all(promises);
    // Allow any pending cleanup callbacks to settle
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  // 3. Backpressure and Controller Cancellation Resilience
  await test("Adversarial 4: Cancellation while background interval timer is active", async () => {
    const stream = createLogStream({ processName: "backpressure-test", lines: 0 });
    const reader = stream.getReader();
    // Read first chunk
    const first = await reader.read();
    assert.ok(first.value);
    // Cancel immediately
    await reader.cancel();

    // Wait 2.5 seconds to ensure any timer scheduled in background triggers safeEnqueue without throwing
    await new Promise((resolve) => setTimeout(resolve, 2500));
  });

  // 4. Multi-Event Live Streaming Schema Rigor
  await test("Adversarial 5: Stream for 3.5 seconds and validate every single event against JSON schema", async () => {
    const stream = createLogStream({ processName: "schema-proc", lines: 2 });
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const startTime = Date.now();
    let eventsReceived = 0;
    let buffer = "";

    while (Date.now() - startTime < 3500) {
      const readPromise = reader.read();
      const timeoutPromise = new Promise<{ value?: Uint8Array; done: boolean }>((r) =>
        setTimeout(() => r({ done: false }), 600)
      );
      const res = await Promise.race([readPromise, timeoutPromise]);
      if (res.value) {
        buffer += decoder.decode(res.value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith(":")) continue; // SSE comment / heartbeat
          assert.ok(trimmed.startsWith("data: "), "SSE lines must start with 'data: '");
          const jsonText = trimmed.replace(/^data:\s*/, "");
          const payload = JSON.parse(jsonText);
          assert.ok(payload.timestamp, "Must have timestamp");
          assert.ok(!isNaN(Date.parse(payload.timestamp)), "Timestamp must be valid ISO");
          assert.ok(payload.process, "Must have process");
          assert.ok(["stdout", "stderr", "system"].includes(payload.type), `Invalid type: ${payload.type}`);
          assert.ok(typeof payload.message === "string", "Message must be string");
          eventsReceived++;
        }
      }
    }

    await reader.cancel();
    assert.ok(eventsReceived >= 2, `Expected >= 2 events received in 3.5s, got ${eventsReceived}`);
  });

  console.log("\n==================================================");
  console.log(`Adversarial Audit Results: ${passed}/${total} passed`);
  console.log("==================================================\n");

  if (passed !== total) {
    process.exit(1);
  }
}

runAdversarialAudit().catch((err) => {
  console.error("Adversarial audit encountered unhandled failure:", err);
  process.exit(1);
});
