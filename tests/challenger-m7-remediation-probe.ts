process.env.NODE_ENV = "test";

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { GET as streamRouteGet } from "../src/app/api/pm2/logs/stream/route";
import { LogEvent } from "../src/lib/log-stream-service";

async function run() {
  console.log("=== Challenger 2 Remediation Probe ===");
  let passed = 0;
  let failed = 0;

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

  const proofFile = path.join(process.cwd(), "pwned_adversarial_test.txt");
  if (fs.existsSync(proofFile)) {
    try { fs.unlinkSync(proofFile); } catch {}
  }

  // 1.1 Malicious targetProcess: app & echo pwned
  await test("1.1: ?targetProcess=app%20%26%20echo%20pwned returns HTTP 400 Bad Request", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?targetProcess=app%20%26%20echo%20pwned");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.deepStrictEqual(body, { error: "Invalid process identifier" });
  });

  // 1.2 Malicious targetProcess: ;ls
  await test("1.2: ?targetProcess=;ls returns HTTP 400 Bad Request", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?targetProcess=;ls");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.deepStrictEqual(body, { error: "Invalid process identifier" });
  });

  // 1.3 Malicious targetProcess: ../../etc/passwd
  await test("1.3: ?targetProcess=../../etc/passwd returns HTTP 400 Bad Request", async () => {
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?targetProcess=../../etc/passwd");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.deepStrictEqual(body, { error: "Invalid process identifier" });
  });

  // 1.4 Extended malicious inputs
  await test("1.4: Extended malicious inputs return HTTP 400 Bad Request", async () => {
    const bad = [
      "foo|dir",
      "app`whoami`",
      "$(calc)",
      "app>out.txt",
      "app<in.txt",
      "test&&dir",
      "test||calc",
      "<script>alert(1)</script>",
      "app\nwhoami",
      "app\r\ncalc",
      "..\\..\\win.ini",
      "proc with spaces",
      "proc$name",
      "-rf /",
    ];
    for (const b of bad) {
      const req = new Request("http://localhost:3000/api/pm2/logs/stream?targetProcess=" + encodeURIComponent(b));
      const res = await streamRouteGet(req);
      assert.strictEqual(res.status, 400, "Failed on: " + b);
      const body = await res.json();
      assert.strictEqual(body.error, "Invalid process identifier");
    }
  });

  // 1.5 Verify NO host commands executed & no files dropped
  await test("1.5: No host commands executed and no files dropped to disk", async () => {
    const dropPayload = "app & echo PWNED > " + proofFile.replace(/\\/g, "/") + " &";
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?targetProcess=" + encodeURIComponent(dropPayload));
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 400);
    await new Promise((r) => setTimeout(r, 500));
    assert.strictEqual(fs.existsSync(proofFile), false, "Proof file must not exist!");
  });

  // 1.6 Valid targetProcess values
  await test("1.6: Valid targetProcess returns HTTP 200 stream", async () => {
    const valid = ["pmmanager-web", "web_app", "api-1", "s.name", "s:3000", "w@c-1", "all", ""];
    for (const v of valid) {
      const req = new Request("http://localhost:3000/api/pm2/logs/stream?targetProcess=" + encodeURIComponent(v) + "&lines=0");
      const res = await streamRouteGet(req);
      assert.strictEqual(res.status, 200, "Failed on valid: " + v);
      assert.ok(res.body);
      const reader = res.body.getReader();
      const { value } = await reader.read();
      await reader.cancel();
      assert.ok(value);
    }
  });

  // 2.1 Endurance test: 5 seconds continuous delivery
  await test("2.1: Maintain active SSE stream for 5s with continuous event delivery", async () => {
    const memBefore = process.memoryUsage();
    const req = new Request("http://localhost:3000/api/pm2/logs/stream?targetProcess=endurance-test&lines=0");
    const res = await streamRouteGet(req);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const events: LogEvent[] = [];
    const eventTimes: number[] = [];
    let rawBuffer = "";
    const startTime = Date.now();
    const TARGET_MS = 5300;

    while (Date.now() - startTime < TARGET_MS) {
      const timeoutPromise = new Promise<{ done: boolean; value?: Uint8Array }>((r) =>
        setTimeout(() => r({ done: false }), 2200)
      );
      const chunk = await Promise.race([reader.read(), timeoutPromise]);
      if (chunk.done) break;
      if (chunk.value) {
        rawBuffer += decoder.decode(chunk.value, { stream: true });
        const parts = rawBuffer.split("\n\n");
        rawBuffer = parts.pop() || "";
        for (const p of parts) {
          const m = p.match(/data:\s*(\{.*?\})/s);
          if (m) {
            try {
              const evt = JSON.parse(m[1]);
              events.push(evt);
              eventTimes.push(Date.now() - startTime);
            } catch {}
          }
        }
      }
    }

    const elapsed = Date.now() - startTime;
    await reader.cancel();

    const memAfter = process.memoryUsage();
    const heapDiffMb = (memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024);

    console.log(`    Duration: ${elapsed}ms, Events: ${events.length}, Heap diff: ${heapDiffMb.toFixed(3)} MB`);
    console.log(`    Event timestamps: ${eventTimes.map(t => t + "ms").join(", ")}`);

    assert.ok(elapsed >= 5000, `Stream terminated prematurely: ${elapsed}ms`);
    assert.ok(events.length >= 3, `Expected >= 3 events over 5.3s, got ${events.length}`);
    assert.ok(heapDiffMb < 30, `Excessive heap growth: ${heapDiffMb.toFixed(2)} MB`);

    for (const evt of events) {
      assert.ok(evt.timestamp && !isNaN(Date.parse(evt.timestamp)), "Invalid timestamp");
      assert.ok(evt.process && evt.process.length > 0, "Invalid process name");
      assert.ok(evt.type === "stdout" || evt.type === "stderr" || evt.type === "system", "Invalid type");
      assert.ok(evt.message && evt.message.length > 0, "Invalid message content");
    }
  });

  console.log(`=== Results: ${passed} Passed, ${failed} Failed ===`);
  if (fs.existsSync(proofFile)) {
    try { fs.unlinkSync(proofFile); } catch {}
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
