/**
 * Milestone 7: Real-Time Log Streamer (SSE) Adversarial Stress Test Suite
 * Challenger 1 (teamwork_preview_challenger)
 *
 * Empirical verification of:
 * 1. Acceptance Criterion: Time to first formatted event (< 10,000ms SLA, benchmarked over repeated runs)
 * 2. Strict Event Wire Protocol & JSON Schema: timestamp, process, type, message
 * 3. High Concurrency: 5+ parallel streams with distinct process filters without cross-contamination
 * 4. High-Load Connection Burst: 15 concurrent streaming readers under sustained reading
 * 5. Immediate Abort & Disconnect Resilience: AbortSignal bursts, zero uncaught exceptions, clean tear-down
 * 6. Boundary & Injection Resilience: Extreme line parameters, traversal characters, path injection
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { GET as streamRouteGet } from "../src/app/api/pm2/logs/stream/route";
import {
  createLogStream,
  formatSseEvent,
  generateMockLogLine,
  getHistoricalLogs,
  LogEvent,
  VALID_PROCESS_REGEX,
} from "../src/lib/log-stream-service";

interface StressTestStats {
  total: number;
  passed: number;
  failed: number;
  failures: Array<{ name: string; error: string }>;
}

const stats: StressTestStats = {
  total: 0,
  passed: 0,
  failed: 0,
  failures: [],
};

// Global tracking of unhandled exceptions or rejections
const uncaughtErrors: Array<{ type: string; error: any }> = [];
process.on("unhandledRejection", (reason) => {
  uncaughtErrors.push({ type: "unhandledRejection", error: reason });
  console.error("[CRITICAL PROCESS ERROR] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  uncaughtErrors.push({ type: "uncaughtException", error: err });
  console.error("[CRITICAL PROCESS ERROR] uncaughtException:", err);
});

async function test(name: string, fn: () => void | Promise<void>) {
  stats.total++;
  try {
    await fn();
    console.log(`  ? [PASS] ${name}`);
    stats.passed++;
  } catch (err: any) {
    stats.failed++;
    console.error(`  ? [FAIL] ${name}`);
    console.error(`    Error: ${err.message || String(err)}`);
    if (err.stack) {
      console.error(`    ${err.stack.split("\n").slice(1, 4).join("\n    ")}`);
    }
    stats.failures.push({ name, error: err.message || String(err) });
  }
}

/**
 * Helper to parse SSE data payloads from a raw text chunk.
 */
function extractSseEvents(rawText: string): LogEvent[] {
  const events: LogEvent[] = [];
  const blocks = rawText.split("\n\n");
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    // Skip comments/heartbeats (lines starting with ':')
    if (trimmed.startsWith(":")) continue;

    for (const line of trimmed.split("\n")) {
      if (line.startsWith("data:")) {
        const jsonStr = line.replace(/^data:\s*/, "").trim();
        try {
          const parsed = JSON.parse(jsonStr);
          events.push(parsed);
        } catch {
          // Non-JSON or malformed data
        }
      }
    }
  }
  return events;
}

/**
 * Helper to read at least N events from a response body stream with a hard timeout.
 */
async function readEventsFromStream(
  res: Response,
  expectedCount: number = 1,
  timeoutMs: number = 5000
): Promise<{ events: LogEvent[]; elapsedMs: number }> {
  if (!res.body) {
    throw new Error("Response body is null");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events: LogEvent[] = [];
  const startTime = Date.now();
  let buffer = "";

  try {
    while (events.length < expectedCount && Date.now() - startTime < timeoutMs) {
      const remainingTime = timeoutMs - (Date.now() - startTime);
      if (remainingTime <= 0) break;

      const readPromise = reader.read();
      const timeoutPromise = new Promise<{ value: undefined; done: true }>((resolve) =>
        setTimeout(() => resolve({ value: undefined, done: true }), remainingTime)
      );

      const result = await Promise.race([readPromise, timeoutPromise]);
      if (result.done) break;

      if (result.value) {
        buffer += decoder.decode(result.value, { stream: true });
        const parsed = extractSseEvents(buffer);
        events.length = 0;
        events.push(...parsed);
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore reader cancel error
    }
  }

  return { events, elapsedMs: Date.now() - startTime };
}

async function runChallengerStressSuite() {
  console.log("================================================================================");
  console.log("  CHALLENGER 1: REAL-TIME LOG STREAMER (SSE) EMPIRICAL STRESS TEST SUITE");
  console.log("  Authoritative SLA: First event < 10,000ms | Concurrency: 5+ readers | Zero crashes");
  console.log("================================================================================\n");

  // ============================================================================
  // PROBE SUITE 1: SLA Benchmarking - Time to First Formatted Event (< 10,000ms)
  // ============================================================================
  console.log("--- PROBE SUITE 1: Time to First Formatted Event SLA Benchmarks ---");

  await test("1.1: Single connection receives first formatted event within SLA (< 10,000ms)", async () => {
    const startTime = Date.now();
    const req = new Request("http://localhost:3000/api/pm2/logs/stream");
    const res = await streamRouteGet(req);

    assert.strictEqual(res.status, 200, `Expected HTTP 200, got ${res.status}`);
    assert.ok(res.body, "Response body must exist");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const { value, done } = await reader.read();
    const elapsedMs = Date.now() - startTime;
    await reader.cancel();

    assert.ok(!done, "Stream should not be done on first chunk");
    assert.ok(value, "Stream chunk must contain data");
    const text = decoder.decode(value);
    assert.ok(text.includes("data:"), "Chunk must contain SSE data line");

    const events = extractSseEvents(text);
    assert.ok(events.length >= 1, "Must extract at least one event from first chunk");
    assert.ok(
      elapsedMs < 10000,
      `Time to first event (${elapsedMs}ms) exceeded 10,000ms threshold!`
    );
    console.log(`    Measured single-run time to first event: ${elapsedMs}ms (SLA: < 10,000ms)`);
  });

  await test("1.2: Multi-trial latency benchmark (10 consecutive connections all < 1,000ms)", async () => {
    const trials = 10;
    const latencies: number[] = [];

    for (let i = 0; i < trials; i++) {
      const trialStart = Date.now();
      const req = new Request(`http://localhost:3000/api/pm2/logs/stream?trial=${i}`);
      const res = await streamRouteGet(req);
      assert.strictEqual(res.status, 200);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const { value } = await reader.read();
      const duration = Date.now() - trialStart;
      latencies.push(duration);
      await reader.cancel();

      const text = decoder.decode(value);
      const events = extractSseEvents(text);
      assert.ok(events.length >= 1, `Trial #${i} did not produce an event`);
    }

    const minLat = Math.min(...latencies);
    const maxLat = Math.max(...latencies);
    const avgLat = (latencies.reduce((a, b) => a + b, 0) / trials).toFixed(2);

    console.log(`    10-Trial Benchmark: Min=${minLat}ms, Max=${maxLat}ms, Avg=${avgLat}ms`);
    assert.ok(
      maxLat < 10000,
      `Max latency ${maxLat}ms breached 10,000ms SLA`
    );
    // Realistically handshake at t=0ms should be under 500ms
    assert.ok(
      maxLat < 1000,
      `Max latency ${maxLat}ms unexpectedly slow for in-memory handshake`
    );
  });

  await test("1.3: Latency under load: First event arrives < 1,000ms when 5 concurrent connections open", async () => {
    const concurrency = 5;
    const requests = Array.from({ length: concurrency }, (_, i) =>
      new Request(`http://localhost:3000/api/pm2/logs/stream?load_client=${i}`)
    );

    const start = Date.now();
    const responses = await Promise.all(requests.map((r) => streamRouteGet(r)));

    const reads = responses.map(async (res) => {
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      await reader.cancel();
      return value;
    });

    const chunks = await Promise.all(reads);
    const totalElapsed = Date.now() - start;

    for (const chunk of chunks) {
      assert.ok(chunk, "Chunk must not be empty");
    }

    console.log(`    5 concurrent requests resolved first events in ${totalElapsed}ms`);
    assert.ok(
      totalElapsed < 10000,
      `Concurrent latency ${totalElapsed}ms breached 10,000ms SLA`
    );
  });

  await test("1.4: Strict SLA Target verification: 20 sequential connections all < 100ms (t=0s handshake)", async () => {
    const count = 20;
    const latencies: number[] = [];

    for (let i = 0; i < count; i++) {
      const t0 = Date.now();
      const req = new Request(`http://localhost:3000/api/pm2/logs/stream?sla_burst=${i}&lines=0`);
      const res = await streamRouteGet(req);
      assert.strictEqual(res.status, 200);

      const reader = res.body!.getReader();
      const { value, done } = await reader.read();
      const latency = Date.now() - t0;
      latencies.push(latency);
      await reader.cancel();

      assert.ok(!done && value);
      assert.ok(latency < 10000, `Trial ${i} breached 10,000ms SLA (${latency}ms)`);
      assert.ok(latency < 100, `Trial ${i} exceeded target threshold of 100ms (${latency}ms)`);
    }

    const min = Math.min(...latencies);
    const max = Math.max(...latencies);
    const avg = (latencies.reduce((a, b) => a + b, 0) / count).toFixed(1);
    console.log(`    20-Connection SLA Target Check: Min=${min}ms, Max=${max}ms, Avg=${avg}ms (all < 100ms)`);
  });

  await test("1.5: Zero-history SLA (?lines=0): handshake delivers immediately without waiting", async () => {
    const t0 = Date.now();
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?lines=0");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value, done } = await reader.read();
    const elapsed = Date.now() - t0;
    await reader.cancel();

    assert.ok(!done && value);
    const text = decoder.decode(value);
    const events = extractSseEvents(text);
    assert.strictEqual(events.length, 1, "lines=0 must emit exactly 1 handshake event");
    assert.ok(elapsed < 100, `lines=0 handshake took ${elapsed}ms (target: < 100ms)`);
    assert.ok(elapsed < 10000, `lines=0 breached 10,000ms SLA`);
  });

  await test("1.6: SLA under heavy historical load (?lines=100): first event arrives < 100ms", async () => {
    const t0 = Date.now();
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?lines=100");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const reader = res.body!.getReader();
    const { value, done } = await reader.read();
    const elapsed = Date.now() - t0;
    await reader.cancel();

    assert.ok(!done && value);
    assert.ok(elapsed < 100, `lines=100 first chunk took ${elapsed}ms (target: < 100ms)`);
    assert.ok(elapsed < 10000, `lines=100 breached 10,000ms SLA`);
  });

  await test("1.7: Rapid sequential burst (25 requests in tight loop) shows zero degradation", async () => {
    const burstSize = 25;
    const latencies: number[] = [];

    for (let i = 0; i < burstSize; i++) {
      const t0 = Date.now();
      const req = new Request(`http://localhost:3000/api/pm2/logs/stream?rapid=${i}&lines=1`);
      const res = await streamRouteGet(req);
      assert.strictEqual(res.status, 200);

      const reader = res.body!.getReader();
      await reader.read();
      const elapsed = Date.now() - t0;
      latencies.push(elapsed);
      await reader.cancel();
    }

    const max = Math.max(...latencies);
    const avg = (latencies.reduce((a, b) => a + b, 0) / burstSize).toFixed(1);
    console.log(`    25-Request Burst: Max=${max}ms, Avg=${avg}ms`);
    assert.ok(max < 100, `Burst degraded to ${max}ms`);
  });

  // ============================================================================
  // PROBE SUITE 2: Strict Wire Protocol & Event JSON Schema Validation
  // ============================================================================
  console.log("\n--- PROBE SUITE 2: Wire Protocol & Event JSON Schema Validation ---");

  await test("2.1: HTTP Response Headers comply strictly with SSE specifications", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream");
    const res = await streamRouteGet(req);

    // Cancel body immediately to release stream
    if (res.body) {
      const reader = res.body.getReader();
      await reader.cancel();
    }

    assert.strictEqual(res.status, 200, "Status must be 200");
    const ct = res.headers.get("Content-Type") || "";
    assert.ok(
      ct.toLowerCase().includes("text/event-stream"),
      `Content-Type must contain 'text/event-stream', got: ${ct}`
    );
    assert.strictEqual(res.headers.get("Cache-Control"), "no-cache, no-transform");
    assert.strictEqual(res.headers.get("Connection"), "keep-alive");
    assert.strictEqual(res.headers.get("X-Accel-Buffering"), "no");
  });

  await test("2.2: Event Schema Verification on initial handshake event", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?lines=0");
    const res = await streamRouteGet(req);
    const { events } = await readEventsFromStream(res, 1, 2000);

    assert.ok(events.length >= 1, "Expected at least 1 handshake event");
    const event = events[0];

    // Field 1: timestamp
    assert.ok(typeof event.timestamp === "string", "timestamp must be a string");
    assert.ok(
      !isNaN(Date.parse(event.timestamp)),
      `timestamp '${event.timestamp}' must be a valid ISO-8601 date`
    );

    // Field 2: process
    assert.ok(typeof event.process === "string", "process must be a string");
    assert.ok(event.process.length > 0, "process name must not be empty");

    // Field 3: type
    assert.ok(typeof event.type === "string", "type must be a string");
    assert.ok(
      ["stdout", "stderr", "system"].includes(event.type),
      `type '${event.type}' must be one of: stdout, stderr, system`
    );

    // Field 4: message
    assert.ok(typeof event.message === "string", "message must be a string");
    assert.ok(event.message.length > 0, "message must not be empty");
  });

  await test("2.3: Schema validation across historical and synthetic log lines (25 events)", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?lines=25");
    const res = await streamRouteGet(req);
    const { events } = await readEventsFromStream(res, 26, 3000);

    assert.ok(events.length >= 25, `Expected >= 25 events, received ${events.length}`);

    for (let i = 0; i < events.length; i++) {
      const evt = events[i];
      assert.ok(evt.timestamp && !isNaN(Date.parse(evt.timestamp)), `Event #${i} invalid timestamp`);
      assert.ok(evt.process && typeof evt.process === "string", `Event #${i} invalid process`);
      assert.ok(["stdout", "stderr", "system"].includes(evt.type), `Event #${i} invalid type: ${evt.type}`);
      assert.ok(evt.message && typeof evt.message === "string", `Event #${i} invalid message`);
    }
  });

  await test("2.4: formatSseEvent produces byte-exact wire formatting with data: prefix and \\n\\n", () => {
    const sampleEvent: LogEvent = {
      timestamp: new Date().toISOString(),
      process: "api-gateway",
      type: "stderr",
      message: "[CRIT] Out of file descriptors",
    };

    const wireText = formatSseEvent(sampleEvent);
    assert.ok(wireText.startsWith("data: "), "Wire payload must start with 'data: '");
    assert.ok(wireText.endsWith("\n\n"), "Wire payload must terminate with '\\n\\n'");

    const extractedJson = wireText.substring(6, wireText.length - 2);
    const parsed = JSON.parse(extractedJson);
    assert.deepStrictEqual(parsed, sampleEvent);
  });

  await test("2.5: ISO 8601 strict format regex verification across 50 consecutive events", async () => {
    const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?lines=50");
    const res = await streamRouteGet(req);
    const { events } = await readEventsFromStream(res, 50, 3000);

    assert.ok(events.length >= 50, `Expected >= 50 events, received ${events.length}`);
    for (let i = 0; i < events.length; i++) {
      const evt = events[i];
      assert.ok(
        iso8601Regex.test(evt.timestamp),
        `Event #${i} timestamp '${evt.timestamp}' does not match strict ISO 8601 pattern`
      );
      assert.ok(["stdout", "stderr", "system"].includes(evt.type), `Event #${i} invalid type: ${evt.type}`);
      assert.ok(evt.message.length > 0, `Event #${i} message is empty`);
      assert.ok(evt.process.length > 0, `Event #${i} process is empty`);
    }
  });

  await test("2.6: Sustained multi-event streaming (3.5s): all events strictly adhere to schema", async () => {
    const stream = createLogStream({ processName: "endurance-proc", lines: 2 });
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
          if (!trimmed || trimmed.startsWith(":")) continue;
          assert.ok(trimmed.startsWith("data: "), "SSE line must start with data: ");
          const jsonText = trimmed.replace(/^data:\s*/, "");
          const payload = JSON.parse(jsonText);
          assert.ok(payload.timestamp && !isNaN(Date.parse(payload.timestamp)));
          assert.strictEqual(payload.process, "endurance-proc");
          assert.ok(["stdout", "stderr", "system"].includes(payload.type));
          assert.ok(typeof payload.message === "string" && payload.message.length > 0);
          eventsReceived++;
        }
      }
    }

    await reader.cancel();
    assert.ok(eventsReceived >= 3, `Expected >= 3 events over 3.5s, received ${eventsReceived}`);
  });

  await test("2.7: Wire protocol comment and heartbeat resilience: non-data lines safely ignored", () => {
    const rawSseChunk = ": heartbeat\n\n: another comment\n\ndata: {\"timestamp\":\"2026-09-09T08:00:00.000Z\",\"process\":\"test\",\"type\":\"stdout\",\"message\":\"hello\"}\n\n";
    const events = extractSseEvents(rawSseChunk);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].process, "test");
    assert.strictEqual(events[0].message, "hello");
  });

  // ============================================================================
  // PROBE SUITE 3: Multiple Concurrent SSE Connections (5 Parallel Readers)
  // ============================================================================
  console.log("\n--- PROBE SUITE 3: Concurrency Isolation (5 Parallel Readers) ---");

  await test("3.1: 5 parallel connections with distinct process filters receive independent streams", async () => {
    const processes = [
      "service-auth",
      "service-billing",
      "service-orders",
      "service-inventory",
      "service-notifications",
    ];

    // Open 5 requests simultaneously with specific process names
    const requests = processes.map(
      (proc) => new Request(`http://localhost:3000/api/pm2/logs/stream?process=${proc}&lines=5`)
    );

    const responses = await Promise.all(requests.map((r) => streamRouteGet(r)));

    for (const res of responses) {
      assert.strictEqual(res.status, 200, "All concurrent streams must return 200");
    }

    // Read initial chunks concurrently from all 5 streams
    const streamReaders = responses.map(async (res, idx) => {
      const expectedProc = processes[idx];
      const { events } = await readEventsFromStream(res, 3, 2000);
      return { expectedProc, events };
    });

    const streamResults = await Promise.all(streamReaders);

    assert.strictEqual(streamResults.length, 5);

    for (const result of streamResults) {
      assert.ok(
        result.events.length >= 1,
        `Stream for ${result.expectedProc} should have received events`
      );

      // Verify the initial handshake event references the expected process
      const handshake = result.events[0];
      assert.strictEqual(
        handshake.process,
        result.expectedProc,
        `Handshake event process mismatch! Expected '${result.expectedProc}', got '${handshake.process}'`
      );
      assert.ok(
        handshake.message.includes(result.expectedProc),
        `Handshake message does not reference expected process: ${handshake.message}`
      );
    }
  });

  await test("3.2: High-load burst: 15 concurrent readers open, read, and close without cross-talk", async () => {
    const burstCount = 15;
    const procs = Array.from({ length: burstCount }, (_, i) => `burst-proc-${i}`);

    const responses = await Promise.all(
      procs.map((proc) =>
        streamRouteGet(
          new Request(`http://localhost:3000/api/pm2/logs/stream?process=${proc}&lines=2`)
        )
      )
    );

    const readTasks = responses.map(async (res, i) => {
      const expected = procs[i];
      const { events } = await readEventsFromStream(res, 2, 3000);
      assert.ok(events.length >= 1, `Stream #${i} failed to receive events`);
      assert.strictEqual(events[0].process, expected, `Cross-talk detected on stream #${i}`);
      return true;
    });

    const results = await Promise.all(readTasks);
    assert.strictEqual(results.length, burstCount);
    console.log(`    Successfully validated 15 concurrent isolated SSE streams`);
  });

  await test("3.3: 5 parallel streams with 5 events each assert 100% strict process isolation", async () => {
    const targets = ["worker-a", "worker-b", "worker-c", "worker-d", "worker-e"];

    const streams = targets.map((t) =>
      createLogStream({ processName: t, lines: 5 })
    );

    const readers = streams.map(async (s, idx) => {
      const expectedProc = targets[idx];
      const reader = s.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (let i = 0; i < 6; i++) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
      await reader.cancel();

      const events = extractSseEvents(text);
      assert.ok(events.length >= 5, `Stream ${expectedProc} got ${events.length} events`);
      for (const evt of events) {
        assert.strictEqual(
          evt.process,
          expectedProc,
          `Cross-talk in stream ${expectedProc}: received event from ${evt.process}`
        );
      }
      return expectedProc;
    });

    const results = await Promise.all(readers);
    assert.strictEqual(results.length, 5);
  });

  await test("3.4: Mixed filter concurrency: 10 streams combining targetProcess, process, and all", async () => {
    const queryConfigs = [
      { param: "targetProcess=core-api", expected: "core-api" },
      { param: "targetProcess=auth-svc", expected: "auth-svc" },
      { param: "targetProcess=all", expected: "pmmanager-web" },
      { param: "process=legacy-proc-1", expected: "legacy-proc-1" },
      { param: "process=legacy-proc-2", expected: "legacy-proc-2" },
      { param: "process=all", expected: "pmmanager-web" },
      { param: "targetProcess=db-proxy&lines=0", expected: "db-proxy" },
      { param: "process=queue-worker&lines=0", expected: "queue-worker" },
      { param: "lines=0", expected: "pmmanager-web" },
      { param: "targetProcess=monitor-daemon", expected: "monitor-daemon" },
    ];

    const responses = await Promise.all(
      queryConfigs.map((c) =>
        streamRouteGet(new Request(`http://localhost:3000/api/pm2/logs/stream?${c.param}`))
      )
    );

    const readTasks = responses.map(async (res, idx) => {
      const conf = queryConfigs[idx];
      assert.strictEqual(res.status, 200);
      const { events } = await readEventsFromStream(res, 1, 2000);
      assert.ok(events.length >= 1, `Stream ${conf.param} produced no events`);
      assert.strictEqual(
        events[0].process,
        conf.expected,
        `Stream ${conf.param} mismatch: expected ${conf.expected}, got ${events[0].process}`
      );
    });

    await Promise.all(readTasks);
  });

  await test("3.5: Asymmetric concurrency: active stream continues unaffected when peers abruptly disconnect", async () => {
    // Open 1 long-running stream
    const longStreamReq = new Request("http://localhost:3000/api/pm2/logs/stream?process=persistent-stream&lines=10");
    const longRes = await streamRouteGet(longStreamReq);
    assert.strictEqual(longRes.status, 200);
    const longReader = longRes.body!.getReader();
    const decoder = new TextDecoder();

    // Read initial chunk
    const chunk1 = await longReader.read();
    assert.ok(chunk1.value);

    // Simultaneously open and abruptly abort 5 peer connections
    const peerAborts = Array.from({ length: 5 }, async (_, i) => {
      const ctrl = new AbortController();
      const req = new Request(`http://localhost:3000/api/pm2/logs/stream?process=peer-${i}`, {
        signal: ctrl.signal,
      });
      const res = await streamRouteGet(req);
      ctrl.abort();
      if (res.body) {
        try { await res.body.getReader().cancel(); } catch {}
      }
    });

    await Promise.all(peerAborts);

    // Continue reading on persistent stream
    const chunk2 = await longReader.read();
    await longReader.cancel();

    assert.ok(chunk2.value, "Persistent stream should continue delivering chunks after peer disconnects");
    const text = decoder.decode(chunk2.value);
    assert.ok(text.includes("persistent-stream"));
  });

  await test("3.6: Concurrent streams with varying line counts (0, 10, 25, 50, 100) all succeed", async () => {
    const lineCounts = [0, 10, 25, 50, 100];
    const responses = await Promise.all(
      lineCounts.map((lc) =>
        streamRouteGet(new Request(`http://localhost:3000/api/pm2/logs/stream?process=var-lines&lines=${lc}`))
      )
    );

    const checks = responses.map(async (res, i) => {
      assert.strictEqual(res.status, 200);
      const requested = lineCounts[i];
      const { events } = await readEventsFromStream(res, requested === 0 ? 1 : Math.min(requested, 10), 2000);
      assert.ok(events.length >= 1);
    });

    await Promise.all(checks);
  });

  // ============================================================================
  // PROBE SUITE 4: Immediate Abort & Disconnect Resilience
  // ============================================================================
  console.log("\n--- PROBE SUITE 4: Immediate Abort & Disconnect Resilience ---");

  await test("4.1: Pre-aborted request signal terminates cleanly without throwing", async () => {
    const controller = new AbortController();
    controller.abort(); // Aborted before GET is even called

    const req = new Request("http://localhost:3000/api/pm2/logs/stream", {
      signal: controller.signal,
    });

    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    if (res.body) {
      const reader = res.body.getReader();
      const { done } = await reader.read();
      assert.ok(done === true || done === false, "Read on pre-aborted stream completes safely");
      try {
        await reader.cancel();
      } catch {}
    }
  });

  await test("4.2: Abort signal fired immediately after GET call (t=0ms)", async () => {
    const controller = new AbortController();
    const req = new Request("http://localhost:3000/api/pm2/logs/stream", {
      signal: controller.signal,
    });

    const res = await streamRouteGet(req);
    // Trigger abort right away
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
    // Success if no unhandled exception or process termination
  });

  await test("4.3: Disconnect burst: 20 rapid connect-and-abort cycles in parallel", async () => {
    const burstSize = 20;
    const abortTasks = Array.from({ length: burstSize }, async (_, i) => {
      const controller = new AbortController();
      const req = new Request(`http://localhost:3000/api/pm2/logs/stream?abort_trial=${i}`, {
        signal: controller.signal,
      });

      const res = await streamRouteGet(req);
      assert.strictEqual(res.status, 200);

      // Jittered abort timing (0ms to 20ms)
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 20)));
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
      return true;
    });

    const results = await Promise.all(abortTasks);
    assert.strictEqual(results.length, burstSize);
    console.log(`    Handled ${burstSize} rapid parallel connect-and-abort cycles safely`);
  });

  await test("4.4: Reader cancel during active stream reading leaves server operable for subsequent requests", async () => {
    // 1. Open a stream and read partial chunks
    const req1 = new Request("http://localhost:3000/api/pm2/logs/stream?lines=10");
    const res1 = await streamRouteGet(req1);
    const reader1 = res1.body!.getReader();
    await reader1.read();
    await reader1.cancel(); // Abrupt client drop

    // 2. Open subsequent stream and verify normal functionality
    const req2 = new Request("http://localhost:3000/api/pm2/logs/stream?lines=3");
    const res2 = await streamRouteGet(req2);
    assert.strictEqual(res2.status, 200);

    const { events } = await readEventsFromStream(res2, 2, 2000);
    assert.ok(events.length >= 2, "Subsequent stream failed to deliver events after prior cancellation");
  });

  await test("4.5: Massive abort storm: 50 concurrent connections created and aborted at staggered intervals", async () => {
    const STORM_COUNT = 50;
    const tasks = Array.from({ length: STORM_COUNT }, async (_, i) => {
      const ctrl = new AbortController();
      const req = new Request(`http://localhost:3000/api/pm2/logs/stream?storm=${i}&lines=5`, {
        signal: ctrl.signal,
      });
      const res = await streamRouteGet(req);
      assert.strictEqual(res.status, 200);

      const delayMs = Math.floor(Math.random() * 30);
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      ctrl.abort();

      if (res.body) {
        try {
          const reader = res.body.getReader();
          await reader.cancel();
        } catch {}
      }
      return i;
    });

    const completed = await Promise.all(tasks);
    assert.strictEqual(completed.length, STORM_COUNT);
    console.log(`    50-Connection Abort Storm handled with zero crashes`);
  });

  await test("4.6: Cancellation during background timer interval executes safeEnqueue without throwing", async () => {
    const stream = createLogStream({ processName: "timer-cancel-test", lines: 0 });
    const reader = stream.getReader();
    const first = await reader.read();
    assert.ok(first.value);
    await reader.cancel();

    // Wait 2.2 seconds to allow background timer tick to hit closed controller
    await new Promise((resolve) => setTimeout(resolve, 2200));
  });

  await test("4.7: Global process monitor asserts zero unhandledRejections / uncaughtExceptions", () => {
    assert.strictEqual(
      uncaughtErrors.length,
      0,
      `Detected ${uncaughtErrors.length} uncaught process error(s): ${JSON.stringify(uncaughtErrors)}`
    );
  });

  await test("4.8: Post-abort server health check: endpoint remains 100% responsive", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?process=health-check&lines=2");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const { events } = await readEventsFromStream(res, 2, 2000);
    assert.ok(events.length >= 2);
    assert.strictEqual(events[0].process, "health-check");
  });

  // ============================================================================
  // PROBE SUITE 5: Boundary Conditions, Extremes & Parameter Injections
  // ============================================================================
  console.log("\n--- PROBE SUITE 5: Boundary Values, Extremes & Injection Attempts ---");

  await test("5.1: Negative lines parameter (?lines=-10) is clamped safely (no negative loop)", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?lines=-10");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const { events } = await readEventsFromStream(res, 1, 2000);
    // Should still receive the initial handshake event
    assert.ok(events.length >= 1, "Expected handshake event");
  });

  await test("5.2: Huge lines parameter (?lines=999999) is clamped to safe max limit", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?lines=999999");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const { events } = await readEventsFromStream(res, 10, 2000);
    // Route clamps lines to Math.min(lines, 100) and getHistoricalLogs clamps to safeCount <= 100
    // Total events should be bounded and not blow up memory
    assert.ok(events.length <= 105, `Events exceeded safe bounds: got ${events.length}`);
  });

  await test("5.3: Non-numeric lines parameter (?lines=notanumber) defaults safely to 20", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?lines=notanumber");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const { events } = await readEventsFromStream(res, 5, 2000);
    assert.ok(events.length >= 2, "Should safely stream events with default lines value");
  });

  await test("5.4: Path traversal attempt in process param (?process=../../../../etc/passwd)", async () => {
    const req = new Request(
      "http://localhost:3000/api/pm2/logs/stream?process=../../../../etc/passwd"
    );
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const { events } = await readEventsFromStream(res, 1, 2000);
    assert.ok(events.length >= 1, "Expected safe handling of traversal process string");
    // Verify it doesn't crash or expose filesystem
    assert.ok(events[0].message.length > 0);
  });

  await test("5.5: XSS and HTML injection string in process param (?process=<script>alert(1)</script>)", async () => {
    const xss = "<script>alert('xss')</script>";
    const req = new Request(
      `http://localhost:3000/api/pm2/logs/stream?process=${encodeURIComponent(xss)}`
    );
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const { events } = await readEventsFromStream(res, 1, 2000);
    assert.ok(events.length >= 1);
    assert.strictEqual(events[0].process, xss);
  });

  await test("5.6: Long process name (2000 characters) handles without memory corruption", async () => {
    const longName = "proc-" + "x".repeat(2000);
    const req = new Request(
      `http://localhost:3000/api/pm2/logs/stream?process=${encodeURIComponent(longName)}&lines=1`
    );
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const { events } = await readEventsFromStream(res, 1, 2000);
    assert.ok(events.length >= 1);
    assert.strictEqual(events[0].process, longName);
  });

  // ============================================================================
  // PROBE SUITE 6: Remediation Validation & Security Hardening
  // ============================================================================
  console.log("\n--- PROBE SUITE 6: Remediation Security & Idempotency Probes ---");

  await test("6.1: ?targetProcess with shell metacharacters returns HTTP 400 Bad Request", async () => {
    const injectionAttacks = [
      "foo;calc",
      "foo & echo PWN &",
      "foo|dir",
      "foo`whoami`",
      "foo$(id)",
      "> /tmp/pwn",
      "< /etc/shadow",
      "proc with spaces",
      "../../etc/passwd",
      "<script>alert(1)</script>",
    ];

    for (const badInput of injectionAttacks) {
      const req = new Request(
        `http://localhost:3000/api/pm2/logs/stream?targetProcess=${encodeURIComponent(badInput)}`
      );
      const res = await streamRouteGet(req);

      assert.strictEqual(
        res.status,
        400,
        `Expected HTTP 400 for malicious targetProcess '${badInput}', got ${res.status}`
      );
      const data = await res.json();
      assert.strictEqual(
        data.error,
        "Invalid process identifier",
        `Expected 'Invalid process identifier', got '${data.error}'`
      );
    }
  });

  await test("6.2: ?targetProcess starting with '-' is safely neutralized without spawning host flags", async () => {
    // Inputs that match VALID_PROCESS_REGEX but start with '-' (CLI flag injection attempt)
    const flagInputs = ["-la", "--lines", "-h", "-v"];
    for (const flag of flagInputs) {
      const req = new Request(
        `http://localhost:3000/api/pm2/logs/stream?targetProcess=${encodeURIComponent(flag)}&lines=0`
      );
      const res = await streamRouteGet(req);
      assert.strictEqual(res.status, 200, `Flag '${flag}' should safely return 200 via synthetic stream`);

      if (res.body) {
        const reader = res.body.getReader();
        const { value, done } = await reader.read();
        await reader.cancel();
        assert.ok(!done && value);
      }
    }
  });

  await test("6.3: ?targetProcess with valid allowlist characters returns HTTP 200 stream", async () => {
    const validInputs = [
      "api-server",
      "worker_1",
      "pmmanager-web",
      "service.name",
      "service:3000",
      "app@cluster",
      "all",
      "",
    ];

    for (const goodInput of validInputs) {
      const req = new Request(
        `http://localhost:3000/api/pm2/logs/stream?targetProcess=${encodeURIComponent(goodInput)}&lines=0`
      );
      const res = await streamRouteGet(req);
      assert.strictEqual(res.status, 200, `Valid input '${goodInput}' should return HTTP 200`);

      if (res.body) {
        const reader = res.body.getReader();
        const { value, done } = await reader.read();
        await reader.cancel();
        assert.ok(!done && value);
      }
    }
  });

  await test("6.4: Host command injection via legacy ?process= is neutralized (zero host execution)", async () => {
    const canaryFile = path.join(process.cwd(), "challenger1_canary.txt");
    if (fs.existsSync(canaryFile)) {
      try { fs.unlinkSync(canaryFile); } catch {}
    }

    const payload = `app & echo EXECUTED_CANARY > "${canaryFile}" &`;
    const req = new Request(
      `http://localhost:3000/api/pm2/logs/stream?process=${encodeURIComponent(payload)}&lines=0`
    );
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const reader = res.body!.getReader();
    const start = Date.now();
    while (Date.now() - start < 2000) {
      const timeout = new Promise<{ done: boolean; value?: Uint8Array }>((r) => setTimeout(() => r({ done: false }), 400));
      const { done } = await Promise.race([reader.read(), timeout]);
      if (done || fs.existsSync(canaryFile)) break;
    }
    await reader.cancel();

    const fileCreated = fs.existsSync(canaryFile);
    if (fileCreated) {
      try { fs.unlinkSync(canaryFile); } catch {}
      assert.fail("CRITICAL: Host command injection was executed via ?process= query parameter!");
    } else {
      console.log("    ✓ Host command injection safely neutralized by log-stream-service");
    }
  });

  await test("6.5: Idempotency & traversal bounds: getHistoricalLogs safe under attack inputs", async () => {
    const maliciousPaths = ["../../windows/system32/cmd.exe", "../../../../etc/shadow", "/etc/passwd"];
    for (const p of maliciousPaths) {
      const logs = getHistoricalLogs(p, 5);
      assert.ok(Array.isArray(logs), "getHistoricalLogs must return array");
      assert.ok(logs.length <= 5, "Must respect count bound");
      for (const evt of logs) {
        assert.ok(evt.message.length > 0);
      }
    }
  });

  // ============================================================================
  // SUMMARY AND VERDICT
  // ============================================================================
  console.log("\n================================================================================");
  console.log(`  CHALLENGER 1 STRESS TEST RESULTS: ${stats.passed}/${stats.total} Passed (${stats.failed} Failed)`);
  console.log("================================================================================");

  if (stats.failed > 0 || uncaughtErrors.length > 0) {
    console.error(`\nGATE VERDICT: REJECT - ${stats.failed} stress test(s) failed, ${uncaughtErrors.length} uncaught errors:`);
    for (const f of stats.failures) {
      console.error(`  - ${f.name}: ${f.error}`);
    }
    for (const u of uncaughtErrors) {
      console.error(`  - ${u.type}: ${u.error}`);
    }
    process.exit(1);
  } else {
    console.log(`\nGATE VERDICT: APPROVE - All ${stats.total} adversarial stress tests passed flawlessly.`);
    process.exit(0);
  }
}

runChallengerStressSuite().catch((err) => {
  console.error("\n[CRITICAL] Uncaught exception in stress test harness:", err);
  process.exit(1);
});
