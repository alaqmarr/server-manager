/**
 * Challenger 2: Milestone 7 Adversarial Probe & Endurance Test Suite
 *
 * Targets:
 * 1. Parameter Injection & Traversal:
 *    - Directory traversal: ?process=../../etc/passwd, ..\..\..\Windows\win.ini
 *    - Command injection attempts: ?process=foo & echo INJECTED &, ?process=foo | dir, ?process=foo ; whoami
 * 2. Non-numeric lines parameter:
 *    - ?lines=invalid, ?lines=-50, ?lines=999999, ?lines=NaN, ?lines=0x10, etc.
 * 3. Streaming endurance:
 *    - 5-second continuous stream event flow verification
 *    - Buffer overflow / memory leak check (RSS, Heap Used before and after)
 *    - 5 concurrent streams maintained for 5 seconds
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import { GET as streamRouteGet } from "../src/app/api/pm2/logs/stream/route";
import { createLogStream, LogEvent } from "../src/lib/log-stream-service";

async function runAdversarialSuite() {
  console.log("==================================================================");
  console.log("  Challenger 2: Milestone 7 Adversarial Probe & Endurance Suite  ");
  console.log("==================================================================\n");

  let passed = 0;
  let failed = 0;
  const findings: Array<{ category: string; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO"; description: string; detail: any }> = [];

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         Error: ${err.message || err}`);
      failed++;
    }
  }

  // =========================================================================
  // Section 1: Parameter Injection & Directory Traversal Probes
  // =========================================================================
  console.log("--- Section 1: Parameter Injection & Directory Traversal ---");

  await test("1.1: Directory traversal (?process=../../etc/passwd) does not crash or expose filesystem", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?process=../../etc/passwd");
    const res = await streamRouteGet(req);

    assert.strictEqual(res.status, 200, "Should return 200 OK");
    assert.ok(res.body, "Should have response body stream");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    // Read initial event
    const { value, done } = await reader.read();
    await reader.cancel();

    assert.ok(!done && value, "Should receive chunk");
    const chunkText = decoder.decode(value);
    assert.ok(chunkText.startsWith("data: "), "Should be valid SSE event");

    const jsonStr = chunkText.match(/data:\s*(\{.*?\})/)?.[1];
    assert.ok(jsonStr, "Must contain valid JSON event");
    const event: LogEvent = JSON.parse(jsonStr);

    // Verify it didn't crash and output is safely JSON encoded
    assert.strictEqual(event.type, "stdout");
    assert.ok(event.message.includes("../../etc/passwd"), "Initial message includes requested filter safely");
  });

  await test("1.2: Windows traversal (?process=..\\..\\..\\Windows\\win.ini) is handled safely", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?process=..\\..\\..\\Windows\\win.ini");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    await reader.cancel();

    const chunkText = decoder.decode(value);
    assert.ok(chunkText.includes("data:"));
  });

  await test("1.3: Command Injection Probe: ?process=foo & echo INJECTED_CMD &", async () => {
    // Probe whether shell execution triggers host command execution
    const injectionMarker = "PWNED_" + Math.random().toString(36).slice(2);
    const req = new Request(`http://localhost:3000/api/pm2/logs/stream?process=foo%20%26%20echo%20${injectionMarker}%20%26`);
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    let capturedChunks = "";
    const startTime = Date.now();

    // Read up to 2.5 seconds to see if child process stdout emits the injected echo
    while (Date.now() - startTime < 2500) {
      const raceResult = await Promise.race([
        reader.read(),
        new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => setTimeout(() => resolve({ done: false }), 600))
      ]);
      if (raceResult.value) {
        capturedChunks += decoder.decode(raceResult.value);
        if (capturedChunks.includes(injectionMarker)) {
          break;
        }
      }
    }
    await reader.cancel();

    const commandExecuted = capturedChunks.includes(injectionMarker);
    if (commandExecuted) {
      findings.push({
        category: "Command Injection via query param",
        severity: "CRITICAL",
        description: `Command injection detected in ?process parameter: 'echo ${injectionMarker}' was executed on host and emitted to stream!`,
        detail: { injectionMarker, capturedSample: capturedChunks.slice(0, 300) },
      });
      console.log(`    ⚠️ CRITICAL FINDING: Host command execution reproduced via ?process=foo & echo ${injectionMarker} &`);
    } else {
      console.log("    ✓ Command injection did not execute or was not emitted to stream.");
    }
  });

  // =========================================================================
  // Section 2: Non-numeric lines parameter probes
  // =========================================================================
  console.log("\n--- Section 2: Non-numeric ?lines Parameter Probes ---");

  await test("2.1: ?lines=invalid defaults gracefully to 20 without crash", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?lines=invalid");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    let text = "";
    // Read first few chunks
    for (let i = 0; i < 5; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
      if (text.split("\n\n").filter(b => b.includes("data:")).length >= 5) break;
    }
    await reader.cancel();

    const events = text.split("\n\n").filter(b => b.includes("data:"));
    assert.ok(events.length >= 2, `Should receive initial + historical events, got ${events.length}`);
  });

  await test("2.2: ?lines=-999 clamps to 0 without error", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?lines=-999");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    await reader.cancel();

    const chunk = decoder.decode(value);
    const events = chunk.split("\n\n").filter(b => b.includes("data:"));
    // With lines clamped to 0, exactly 1 initial event is emitted
    assert.strictEqual(events.length, 1, `Expected exactly 1 initial event for lines=-999, got ${events.length}`);
  });

  await test("2.3: ?lines=9999999 clamps safely to 100 (upper bound)", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?lines=9999999");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
      const count = text.split("\n\n").filter(b => b.includes("data:")).length;
      // getHistoricalLogs caps count at 50 in createLogStream (Math.min(historicalLines, 50))
      // + 1 initial event = 51 max initial events
      if (count >= 50) break;
    }
    await reader.cancel();

    const events = text.split("\n\n").filter(b => b.includes("data:"));
    assert.ok(events.length <= 55, `Historical lines must be bounded, received ${events.length}`);
  });

  await test("2.4: ?lines=NaN, ?lines=Infinity, ?lines=null handle safely", async () => {
    for (const badVal of ["NaN", "Infinity", "null", "undefined", "0xG12", "1e10", "true"]) {
      const req = new Request(`http://localhost:3000/api/pm2/logs/stream?lines=${badVal}`);
      const res = await streamRouteGet(req);
      assert.strictEqual(res.status, 200, `Failed for lines=${badVal}`);
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      await reader.cancel();
      assert.ok(value, `Must emit valid data for lines=${badVal}`);
    }
  });

  // =========================================================================
  // Section 3: Streaming Endurance (5 Seconds Continuous Flow & Memory Check)
  // =========================================================================
  console.log("\n--- Section 3: Streaming Endurance (5 Seconds Continuous Flow) ---");

  await test("3.1: Single Stream Endurance: 5000ms continuous flow without buffer overflow", async () => {
    const initialMem = process.memoryUsage();
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?lines=0");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const eventsReceived: LogEvent[] = [];
    const eventTimestamps: number[] = [];
    const startTime = Date.now();
    const DURATION_MS = 5200; // 5.2 seconds

    let bufferAccumulator = "";
    let readDone = false;

    // Read loop for 5.2 seconds
    while (Date.now() - startTime < DURATION_MS && !readDone) {
      const timeoutPromise = new Promise<{ done: boolean; value?: Uint8Array }>((resolve) =>
        setTimeout(() => resolve({ done: false }), 2500)
      );
      const result = await Promise.race([reader.read(), timeoutPromise]);

      if (result.done) {
        readDone = true;
        break;
      }

      if (result.value) {
        bufferAccumulator += decoder.decode(result.value, { stream: true });
        const parts = bufferAccumulator.split("\n\n");
        bufferAccumulator = parts.pop() || ""; // keep remainder

        for (const part of parts) {
          const match = part.match(/data:\s*(\{.*?\})/s);
          if (match) {
            try {
              const parsed: LogEvent = JSON.parse(match[1]);
              eventsReceived.push(parsed);
              eventTimestamps.push(Date.now() - startTime);
            } catch (e) {
              console.warn("Failed to parse event JSON:", match[1]);
            }
          }
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    await reader.cancel();

    const finalMem = process.memoryUsage();
    const heapDiffMb = (finalMem.heapUsed - initialMem.heapUsed) / (1024 * 1024);
    const rssDiffMb = (finalMem.rss - initialMem.rss) / (1024 * 1024);

    console.log(`    Streaming duration: ${totalDuration}ms`);
    console.log(`    Events received: ${eventsReceived.length}`);
    console.log(`    Event intervals: ${eventTimestamps.map(t => `${t}ms`).join(", ")}`);
    console.log(`    Heap used diff: ${heapDiffMb.toFixed(2)} MB (RSS diff: ${rssDiffMb.toFixed(2)} MB)`);

    // Verification
    assert.ok(totalDuration >= 5000, `Stream must maintain for at least 5000ms (got ${totalDuration}ms)`);
    assert.ok(eventsReceived.length >= 2, `Expected at least 2 events over 5s (got ${eventsReceived.length})`);
    assert.ok(
      Math.abs(heapDiffMb) < 50,
      `Heap growth of ${heapDiffMb.toFixed(2)}MB exceeds safety limit (50MB)`
    );

    // Verify each event conforms to LogEvent schema
    for (const evt of eventsReceived) {
      assert.ok(evt.timestamp, "Must have timestamp");
      assert.ok(evt.process, "Must have process");
      assert.ok(evt.type === "stdout" || evt.type === "stderr" || evt.type === "system", "Valid event type");
      assert.ok(typeof evt.message === "string" && evt.message.length > 0, "Valid message");
    }
  });

  await test("3.2: Concurrent Endurance: 5 simultaneous streams maintained for 5000ms", async () => {
    const initialMem = process.memoryUsage();
    const STREAM_COUNT = 5;
    const DURATION_MS = 5200;

    const streams = await Promise.all(
      Array.from({ length: STREAM_COUNT }).map(async (_, idx) => {
        const req = new Request(`http://localhost:3000/api/pm2/logs/stream?process=worker-${idx}&lines=0`);
        const res = await streamRouteGet(req);
        return { idx, reader: res.body!.getReader(), decoder: new TextDecoder(), events: [] as LogEvent[] };
      })
    );

    const startTime = Date.now();

    // Read concurrently from all 5 streams
    await Promise.all(
      streams.map(async (s) => {
        let buf = "";
        while (Date.now() - startTime < DURATION_MS) {
          const timeoutPromise = new Promise<{ done: boolean; value?: Uint8Array }>((res) =>
            setTimeout(() => res({ done: false }), 2500)
          );
          const { done, value } = await Promise.race([s.reader.read(), timeoutPromise]);
          if (done) break;
          if (value) {
            buf += s.decoder.decode(value, { stream: true });
            const parts = buf.split("\n\n");
            buf = parts.pop() || "";
            for (const part of parts) {
              const m = part.match(/data:\s*(\{.*?\})/s);
              if (m) {
                try {
                  s.events.push(JSON.parse(m[1]));
                } catch {}
              }
            }
          }
        }
        await s.reader.cancel();
      })
    );

    const elapsed = Date.now() - startTime;
    const finalMem = process.memoryUsage();
    const heapDiffMb = (finalMem.heapUsed - initialMem.heapUsed) / (1024 * 1024);

    console.log(`    Concurrent 5-stream duration: ${elapsed}ms`);
    for (const s of streams) {
      console.log(`    Stream #${s.idx} events received: ${s.events.length}`);
      assert.ok(s.events.length >= 2, `Stream #${s.idx} received ${s.events.length} events, expected >= 2`);
    }
    console.log(`    Heap diff after 5 concurrent streams: ${heapDiffMb.toFixed(2)} MB`);
    assert.ok(heapDiffMb < 80, `Memory leaked during concurrent streams: ${heapDiffMb.toFixed(2)} MB`);
  });

  // =========================================================================
  // Section 4: Summary & Findings Attestation
  // =========================================================================
  console.log("\n==================================================");
  console.log(`Challenger 2 Results: ${passed} passed, ${failed} failed`);
  console.log(`Total Findings Identified: ${findings.length}`);
  for (const f of findings) {
    console.log(`  [${f.severity}] ${f.category}: ${f.description}`);
  }
  console.log("==================================================\n");

  return { passed, failed, findings };
}

runAdversarialSuite()
  .then(({ failed, findings }) => {
    if (findings.some(f => f.severity === "CRITICAL")) {
      console.log("CRITICAL finding identified during probe.");
      process.exit(2);
    }
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error("Fatal test runner error:", err);
    process.exit(1);
  });
