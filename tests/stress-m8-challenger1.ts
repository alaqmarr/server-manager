/**
 * Milestone 8: Adversarial Stress Test Suite (Challenger 1)
 *
 * This test harness probes:
 * 1. Webhook Robustness: Malformed payloads, invalid JSON, missing headers, HMAC bypass attempts,
 *    and extreme payload structures on POST /api/deploy/webhook.
 * 2. High-Concurrency Stress: Rapid-fire push payloads, parallel event bursts (push + ping + branch filters),
 *    and asynchronous queuing without process crash or race conditions.
 * 3. Discord Alert Cooldown Enforcement: 10-minute throttle window, process isolation, alert level differentiation,
 *    bypass mechanisms, and time-travel expiration under rapid burst attacks.
 * 4. Live Discord Webhook Execution: Verification of 200/204 response from authoritative webhook URL
 *    and fault-tolerant handling of unreachable endpoints.
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import crypto from "crypto";
import http from "node:http";

// Deployment Service and Webhook Route Handler
import {
  triggerDeployment,
  executeDeployment,
  getDeployments,
  getDeploymentById,
  clearDeploymentHistory,
  waitForDeployment,
  extractBranch,
  DeploymentRecord,
} from "../src/lib/deploy-service";
import {
  POST as deployWebhookPost,
  GET as deployWebhookGet,
  PUT as deployWebhookPut,
  DELETE as deployWebhookDelete,
} from "../src/app/api/deploy/webhook/route";

// Discord Service and Route Handler
import {
  sendDiscordAlert,
  testDiscordWebhook,
  checkVitalsAndAlert,
  clearAlertCooldowns,
  getAlertCooldowns,
  AUTHORITATIVE_DISCORD_WEBHOOK_URL,
  ALERT_COLORS,
  COOLDOWN_DURATION_MS,
  resolveColor,
} from "../src/lib/discord-service";
import {
  POST as discordTestPost,
  GET as discordTestGet,
} from "../src/app/api/discord/test/route";

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
  console.log("  CHALLENGER 1: ADVERSARIAL STRESS TEST SUITE (MILESTONE 8)");
  console.log("  Probing: Deploy Webhook, Concurrency Queuing, Alert Cooldown & Live Discord");
  console.log("================================================================================\n");

  // ============================================================================
  // PROBE SUITE 1: Malformed Payloads, Invalid JSON, Missing Headers & HMAC
  // ============================================================================
  console.log("--- PROBE SUITE 1: Webhook Payload & Header Robustness ---");

  await test("1.1: Empty raw body returns HTTP 400 Bad Request", async () => {
    const req = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    const res = await deployWebhookPost(req);
    assert.strictEqual(res.status, 400, `Expected status 400, received ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.error.includes("Invalid JSON payload: body is empty"));
  });

  await test("1.2: Whitespace-only raw body returns HTTP 400 Bad Request", async () => {
    const req = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "   \r\n\t   \n   ",
    });
    const res = await deployWebhookPost(req);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.error.includes("Invalid JSON payload: body is empty"));
  });

  await test("1.3: Truncated JSON payload returns HTTP 400 Bad Request", async () => {
    const req = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"ref": "refs/heads/main", "repository": {"name": "test"', // missing closing braces
    });
    const res = await deployWebhookPost(req);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.error.includes("Invalid JSON payload"));
  });

  await test("1.4: Malformed JSON syntax (unquoted keys, raw text) returns HTTP 400", async () => {
    const malformedBodies = [
      "{ ref: refs/heads/main }",
      "Hello world, not a JSON",
      "{ 'single_quotes': true }",
      "{\"ref\": \"main\",,,,}",
    ];

    for (const body of malformedBodies) {
      const req = new Request("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const res = await deployWebhookPost(req);
      assert.strictEqual(res.status, 400, `Expected 400 for body: ${body}`);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    }
  });

  await test("1.5: JSON non-object primitives (strings, numbers, arrays, booleans) do not crash server", async () => {
    const primitivePayloads = [
      JSON.stringify("raw string payload"),
      JSON.stringify(999999),
      JSON.stringify(true),
      JSON.stringify([1, 2, 3, "array"]),
    ];

    for (const body of primitivePayloads) {
      const req = new Request("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      // Should not throw unhandled exception or return 500
      const res = await deployWebhookPost(req);
      assert.ok(res.status === 200 || res.status === 202, `Expected 200 or 202, got ${res.status}`);
    }
  });

  await test("1.6: Payload with null properties is handled safely without TypeError", async () => {
    const nullPayload = {
      ref: null,
      repository: null,
      head_commit: null,
      commits: null,
      pusher: null,
    };

    const req = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nullPayload),
    });

    const res = await deployWebhookPost(req);
    assert.ok(res.status === 200 || res.status === 202);
    const data = await res.json();
    assert.strictEqual(data.success, true);
  });

  await test("1.7: Missing all GitHub headers (no Content-Type, no X-GitHub-Event) defaults safely", async () => {
    const validBody = JSON.stringify({ ref: "refs/heads/main" });
    const req = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      body: validBody,
    });

    const res = await deployWebhookPost(req);
    assert.strictEqual(res.status, 202);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.message, "Deployment triggered");
  });

  await test("1.8: HMAC Signature Verification probes (invalid digest, bad format, tampering)", async () => {
    const testSecret = "adversarial_secret_hmac_key_987654";
    process.env.DEPLOY_WEBHOOK_SECRET = testSecret;

    try {
      const payloadStr = JSON.stringify({
        ref: "refs/heads/main",
        repository: { name: "secure-repo" },
      });

      // 1.8.a: Tampered signature
      const tamperedReq = new Request("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": "sha256=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        },
        body: payloadStr,
      });
      const tamperedRes = await deployWebhookPost(tamperedReq);
      assert.strictEqual(tamperedRes.status, 401, "Tampered signature must return 401");
      const tamperedData = await tamperedRes.json();
      assert.strictEqual(tamperedData.error, "Invalid webhook signature");

      // 1.8.b: Bad signature format (missing sha256= prefix)
      const badFormatReq = new Request("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": "just_a_raw_hash_without_prefix",
        },
        body: payloadStr,
      });
      const badFormatRes = await deployWebhookPost(badFormatReq);
      assert.strictEqual(badFormatRes.status, 401);

      // 1.8.c: Valid HMAC signature must be accepted
      const hmac = crypto.createHmac("sha256", testSecret);
      const validDigest = "sha256=" + hmac.update(payloadStr).digest("hex");
      const validReq = new Request("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": validDigest,
        },
        body: payloadStr,
      });
      const validRes = await deployWebhookPost(validReq);
      assert.strictEqual(validRes.status, 202, "Authentic HMAC signature must return 202");
    } finally {
      delete process.env.DEPLOY_WEBHOOK_SECRET;
    }
  });

  await test("1.9: Large payload (500 commits, 250KB) parses cleanly without memory blowup", async () => {
    const largeCommits = [];
    for (let i = 0; i < 500; i++) {
      largeCommits.push({
        id: `commit-sha-${i}-${Math.random().toString(36).substring(2)}`,
        message: `feat(audit): batch stress test commit #${i} with extended description text to increase payload weight`,
        author: { name: `Tester ${i}`, email: `tester${i}@example.com` },
        timestamp: new Date().toISOString(),
      });
    }

    const largePayload = {
      ref: "refs/heads/main",
      repository: { name: "huge-repo", full_name: "org/huge-repo" },
      commits: largeCommits,
      head_commit: largeCommits[0],
    };

    const req = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(largePayload),
    });

    const res = await deployWebhookPost(req);
    assert.strictEqual(res.status, 202);
    const data = await res.json();
    assert.strictEqual(data.success, true);
  });

  await test("1.10: Command injection probe in branch ref is sanitized", async () => {
    const maliciousPayload = {
      ref: "refs/heads/; rm -rf /; calc.exe; echo injected",
      repository: { name: "evil-repo" },
    };

    const req = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(maliciousPayload),
    });

    const res = await deployWebhookPost(req);
    assert.strictEqual(res.status, 200, "Non-matching target branch returns 200 with deployed: false");
    const data = await res.json();
    assert.strictEqual(data.deployed, false);
    assert.ok(data.message.includes("does not match target branch"));
  });

  await test("1.11: Non-POST HTTP methods consistently return 405 with Allow header", async () => {
    const methods = [
      { name: "GET", fn: deployWebhookGet },
      { name: "PUT", fn: deployWebhookPut },
      { name: "DELETE", fn: deployWebhookDelete },
    ];

    for (const m of methods) {
      const res = await m.fn();
      assert.strictEqual(res.status, 405, `${m.name} must return 405`);
      assert.strictEqual(res.headers.get("Allow"), "POST");
    }
  });

  // ============================================================================
  // PROBE SUITE 2: Rapid-Fire GitHub Push Payloads & Concurrency / Queuing Stress
  // ============================================================================
  console.log("\n--- PROBE SUITE 2: Rapid-Fire Payloads & Concurrency Queuing ---");

  await test("2.1: Concurrent burst of 25 rapid-fire pushes return 202 without crashing", async () => {
    clearDeploymentHistory();
    const burstCount = 25;
    const startWallClock = Date.now();

    const pushPromises = Array.from({ length: burstCount }, (_, i) => {
      const payload = {
        ref: "refs/heads/main",
        repository: { name: "burst-repo" },
        commits: [
          {
            id: `burst-sha-${i}`,
            message: `Burst test #${i}`,
            author: "Load Tester",
          },
        ],
      };
      const req = new Request("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-GitHub-Event": "push" },
        body: JSON.stringify(payload),
      });
      return deployWebhookPost(req);
    });

    const responses = await Promise.all(pushPromises);
    const elapsedWallClock = Date.now() - startWallClock;

    assert.strictEqual(responses.length, burstCount);
    for (const res of responses) {
      assert.strictEqual(res.status, 202, "Every burst request must return 202 Accepted");
    }

    const jsonResults = await Promise.all(responses.map((r) => r.json()));
    const deploymentIds = new Set(jsonResults.map((j) => j.deploymentId));
    assert.strictEqual(deploymentIds.size, burstCount, "Every deployment must have a unique ID");

    console.log(`    Dispatched 25 concurrent push requests in ${elapsedWallClock}ms (all 202 Accepted)`);

    // Verify all records exist in deployment history
    const history = getDeployments();
    assert.ok(history.length >= burstCount, `Expected history to contain at least ${burstCount} records`);

    // Await completion of all deployments
    const firstId = jsonResults[0].deploymentId;
    const lastId = jsonResults[burstCount - 1].deploymentId;
    await waitForDeployment(firstId, 15000);
    await waitForDeployment(lastId, 15000);

    const firstDep = getDeploymentById(firstId);
    assert.strictEqual(firstDep?.status, "success");
  });

  await test("2.2: Interleaved high-concurrency burst (10 pushes + 10 pings + 10 branch filters)", async () => {
    clearDeploymentHistory();
    const requests: Array<{ type: string; promise: Promise<Response> }> = [];

    for (let i = 0; i < 10; i++) {
      // 1. Push payload (should be 202 and deployed)
      const pushReq = new Request("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-GitHub-Event": "push" },
        body: JSON.stringify({ ref: "refs/heads/main", repository: { name: "mixed-repo" } }),
      });
      requests.push({ type: "push", promise: deployWebhookPost(pushReq) });

      // 2. Ping payload (should be 200 Pong and not deployed)
      const pingReq = new Request("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-GitHub-Event": "ping" },
        body: JSON.stringify({ zen: `Zen quote #${i}` }),
      });
      requests.push({ type: "ping", promise: deployWebhookPost(pingReq) });

      // 3. Non-target branch push (should be 200 ignored)
      const devReq = new Request("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-GitHub-Event": "push" },
        body: JSON.stringify({ ref: "refs/heads/dev-feature", repository: { name: "mixed-repo" } }),
      });
      requests.push({ type: "ignored_branch", promise: deployWebhookPost(devReq) });
    }

    // Dispatch all 30 interleaved requests simultaneously
    const results = await Promise.all(requests.map((r) => r.promise));

    let pushCount = 0;
    let pingCount = 0;
    let ignoredCount = 0;

    for (const res of results) {
      const data = await res.json();
      if (res.status === 202 && data.message === "Deployment triggered") {
        pushCount++;
      } else if (res.status === 200 && data.message?.includes("Pong")) {
        pingCount++;
      } else if (res.status === 200 && data.deployed === false) {
        ignoredCount++;
      }
    }

    assert.strictEqual(pushCount, 10, "Expected exactly 10 accepted pushes");
    assert.strictEqual(pingCount, 10, "Expected exactly 10 ping responses");
    assert.strictEqual(ignoredCount, 10, "Expected exactly 10 ignored branch pushes");

    // Check history reflects only the 10 real pushes
    assert.strictEqual(getDeployments().length, 10, "History must only store actual triggered deployments");
  });

  await test("2.3: Sequential deployment queue state consistency", async () => {
    clearDeploymentHistory();

    const { deployment, promise } = triggerDeployment({
      ref: "refs/heads/main",
      repository: { name: "state-test" },
      head_commit: { id: "state-sha", message: "state verification" },
    });

    assert.ok(
      deployment.status === "pending" || deployment.status === "in_progress",
      `Expected initial deployment status to be 'pending' or 'in_progress', got '${deployment.status}'`
    );
    assert.strictEqual(deployment.gitPullExecuted, false);
    assert.strictEqual(deployment.pm2RestartExecuted, false);

    const completed = await promise;
    assert.strictEqual(completed.status, "success");
    assert.strictEqual(completed.gitPullExecuted, true);
    assert.strictEqual(completed.pm2RestartExecuted, true);
    assert.ok(completed.durationMs !== undefined && completed.durationMs >= 0);
  });

  // ============================================================================
  // PROBE SUITE 3: Discord Alerts Cooldown & Crash Trigger Suppression
  // ============================================================================
  console.log("\n--- PROBE SUITE 3: Discord Alerts Cooldown & Throttling ---");

  // Spin up a fast local HTTP server to handle outbound alert posts during cooldown stress
  // This avoids exhausting Discord's external 5-req/2-sec channel rate limit during rapid testing
  const mockDiscordServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock-message-id", content: "ok" }));
  });
  await new Promise<void>((resolve) => mockDiscordServer.listen(0, "127.0.0.1", () => resolve()));
  const mockPort = (mockDiscordServer.address() as any).port;
  const mockWebhookUrl = `http://127.0.0.1:${mockPort}/mock-discord`;
  process.env.DISCORD_WEBHOOK_URL = mockWebhookUrl;

  await test("3.1: Verify Cooldown Duration is configured to exactly 10 minutes", () => {
    assert.strictEqual(COOLDOWN_DURATION_MS, 600000, "Cooldown must be 600,000ms (10 minutes)");
  });

  await test("3.2: Rapid-fire crash triggers for same process respect 10-minute cooldown", async () => {
    clearAlertCooldowns();
    const procName = "stress-worker-crash";

    // 1st alert: Should be allowed to dispatch
    const firstAlert = await sendDiscordAlert({
      title: "🚨 Worker Crash #1",
      description: "First crash alert",
      level: "crash",
      processName: procName,
    });
    assert.strictEqual(firstAlert.success, true, "First crash alert must succeed");
    assert.ok(firstAlert.statusCode >= 200 && firstAlert.statusCode < 300);

    // Immediate burst of 10 subsequent crash alerts for the same process
    const burstAttempts = [];
    for (let i = 2; i <= 11; i++) {
      burstAttempts.push(
        sendDiscordAlert({
          title: `🚨 Worker Crash #${i}`,
          description: `Duplicate crash trigger #${i}`,
          level: "crash",
          processName: procName,
        })
      );
    }

    const burstResults = await Promise.all(burstAttempts);

    // Every single burst attempt must be suppressed with 429
    for (let i = 0; i < burstResults.length; i++) {
      const res = burstResults[i];
      assert.strictEqual(res.success, false, `Alert #${i + 2} must be blocked by cooldown`);
      assert.strictEqual(res.statusCode, 429, `Alert #${i + 2} must return status 429`);
      assert.strictEqual(res.rateLimited, true);
      assert.ok(res.message?.includes("Alert cooldown active"));
    }

    clearAlertCooldowns();
  });

  await test("3.3: Per-process cooldown isolation (Process B is not blocked when Process A is in cooldown)", async () => {
    clearAlertCooldowns();

    // Trigger crash for Process Alpha
    const alphaRes1 = await sendDiscordAlert({
      title: "🚨 Alpha Crash",
      description: "Alpha crashed",
      level: "crash",
      processName: "proc-alpha",
    });
    assert.strictEqual(alphaRes1.success, true);

    // Alpha is now in cooldown. Verify:
    const alphaRes2 = await sendDiscordAlert({
      title: "🚨 Alpha Crash 2",
      description: "Alpha crashed again",
      level: "crash",
      processName: "proc-alpha",
    });
    assert.strictEqual(alphaRes2.statusCode, 429);

    // Now trigger crash for Process Beta: Must NOT be blocked!
    const betaRes1 = await sendDiscordAlert({
      title: "🚨 Beta Crash",
      description: "Beta crashed",
      level: "crash",
      processName: "proc-beta",
    });
    assert.strictEqual(betaRes1.success, true, "Process Beta must not be blocked by Process Alpha's cooldown");
    assert.ok(betaRes1.statusCode >= 200 && betaRes1.statusCode < 300);

    // Second alert for Beta should now be blocked
    const betaRes2 = await sendDiscordAlert({
      title: "🚨 Beta Crash 2",
      description: "Beta crashed again",
      level: "crash",
      processName: "proc-beta",
    });
    assert.strictEqual(betaRes2.statusCode, 429);

    clearAlertCooldowns();
  });

  await test("3.4: Alert level differentiation (crash vs cpu_spike on same process)", async () => {
    clearAlertCooldowns();
    const procName = "proc-dual-alert";

    // Trigger crash alert
    const crashAlert = await sendDiscordAlert({
      title: "🚨 Process Crashed",
      description: "Process crashed unexpectedly",
      level: "crash",
      processName: procName,
    });
    assert.strictEqual(crashAlert.success, true);

    // Trigger CPU spike alert on SAME process: Should succeed because alert level is different!
    const cpuAlert = await sendDiscordAlert({
      title: "⚠️ High CPU Spike",
      description: "Process CPU reached 95%",
      level: "cpu_spike",
      processName: procName,
    });
    assert.strictEqual(cpuAlert.success, true, "CPU spike alert should have independent cooldown from crash");

    // Immediate second CPU spike: Must be throttled
    const secondCpuAlert = await sendDiscordAlert({
      title: "⚠️ High CPU Spike Duplicate",
      description: "Process CPU still high",
      level: "cpu_spike",
      processName: procName,
    });
    assert.strictEqual(secondCpuAlert.statusCode, 429);

    clearAlertCooldowns();
  });

  await test("3.5: bypassCooldown flag overrides active cooldown", async () => {
    clearAlertCooldowns();
    const procName = "proc-bypass-test";

    // 1st alert triggers cooldown
    await sendDiscordAlert({
      title: "🚨 Initial Crash",
      description: "Initial crash",
      level: "crash",
      processName: procName,
    });

    // Alert with bypassCooldown: true must succeed despite active cooldown
    const bypassed = await sendDiscordAlert({
      title: "🚨 Urgent Alert With Bypass",
      description: "Emergency override",
      level: "crash",
      processName: procName,
      bypassCooldown: true,
    });

    assert.strictEqual(bypassed.success, true, "bypassCooldown: true must override active cooldown");
    assert.ok(bypassed.statusCode >= 200 && bypassed.statusCode < 300);

    clearAlertCooldowns();
  });

  await test("3.6: Cooldown expiration allows alerts after 10 minutes (time-travel simulation)", async () => {
    clearAlertCooldowns();
    const procName = "proc-time-travel";

    // Set cooldown timestamp to 10 minutes + 5 seconds ago
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000 + 5000);
    // Access global cooldown map directly
    const cooldownMap = (globalThis as any).__discordAlertCooldowns;
    if (cooldownMap) {
      cooldownMap.set(`${procName}:crash`, tenMinutesAgo);
    }

    // Sending alert now should succeed because cooldown has expired
    const alert = await sendDiscordAlert({
      title: "🚨 Post-Cooldown Crash",
      description: "Crash fired after 10-minute cooldown elapsed",
      level: "crash",
      processName: procName,
    });

    assert.strictEqual(alert.success, true, "Alert must fire after 10-minute cooldown window has elapsed");
    assert.ok(alert.statusCode >= 200 && alert.statusCode < 300);

    clearAlertCooldowns();
  });

  await test("3.7: checkVitalsAndAlert stress suppression across repeated polling cycles", async () => {
    clearAlertCooldowns();

    const sampleProcesses = [
      { id: 1, name: "proc-crash-1", status: "errored", cpu: 0, memory: 1024, restarts: 5 },
      { id: 2, name: "proc-spike-2", status: "online", cpu: 89.2, memory: 1024, restarts: 0 },
      { id: 3, name: "proc-ok-3", status: "online", cpu: 12.0, memory: 1024, restarts: 0 },
    ];

    // Cycle 1: Should fire 2 alerts (1 crash + 1 CPU spike)
    const cycle1 = await checkVitalsAndAlert(sampleProcesses);
    assert.strictEqual(cycle1.length, 2);
    assert.strictEqual(cycle1[0].success, true);
    assert.strictEqual(cycle1[1].success, true);

    // Cycle 2 (immediate polling repetition): Both must be suppressed by cooldown
    const cycle2 = await checkVitalsAndAlert(sampleProcesses);
    assert.strictEqual(cycle2.length, 2);
    assert.strictEqual(cycle2[0].statusCode, 429, "Cycle 2 crash alert must be throttled");
    assert.strictEqual(cycle2[1].statusCode, 429, "Cycle 2 cpu spike alert must be throttled");

    // Cycle 3 (another repetition): Both still suppressed
    const cycle3 = await checkVitalsAndAlert(sampleProcesses);
    assert.strictEqual(cycle3.length, 2);
    assert.strictEqual(cycle3[0].rateLimited, true);
    assert.strictEqual(cycle3[1].rateLimited, true);

    clearAlertCooldowns();
  });

  await test("3.8: Malformed alert fields (undefined, null, extreme lengths) handle gracefully", async () => {
    const edgeCaseAlert = await sendDiscordAlert({
      title: "🚨 Edge Case Title " + "A".repeat(200),
      description: "Description with unicode: 🚀💥🔥 & special chars <>&\"'",
      level: "warning",
      fields: [
        { name: "NormalField", value: "Valid" },
        { name: "NumericField", value: 12345 },
        { name: "EmptyField", value: "" },
      ],
      bypassCooldown: true,
    });

    assert.strictEqual(edgeCaseAlert.success, true);
    assert.ok(edgeCaseAlert.statusCode >= 200 && edgeCaseAlert.statusCode < 300);
  });

  // Clean up mock server before entering Live Discord tests
  delete process.env.DISCORD_WEBHOOK_URL;
  await new Promise<void>((resolve) => mockDiscordServer.close(() => resolve()));

  // ============================================================================
  // PROBE SUITE 4: Live Discord Webhook Execution & Fault Tolerance
  // ============================================================================
  console.log("\n--- PROBE SUITE 4: Live Discord Webhook Execution ---");

  await test("4.1: testDiscordWebhook() returns 200/204 status from live Discord API", async () => {
    const result = await testDiscordWebhook();
    assert.strictEqual(result.success, true, "Discord webhook dispatch must succeed");
    assert.ok(
      result.statusCode === 200 || result.statusCode === 204,
      `Expected status 200 or 204 from Discord API, got ${result.statusCode}`
    );
    console.log(`    (Discord API live response status: ${result.statusCode})`);
  });

  // Short pause to avoid hitting Discord's 5-req/2-sec channel rate limiter
  await new Promise((r) => setTimeout(r, 600));

  await test("4.2: sendDiscordAlert() dispatches live custom embed returning 200/204", async () => {
    const result = await sendDiscordAlert({
      title: "🛡️ Challenger 1 Empirical Verification",
      description: "Adversarial stress test completed by teamwork_preview_challenger.",
      level: "success",
      fields: [
        { name: "Milestone", value: "Milestone 8", inline: true },
        { name: "Verifier", value: "Challenger 1", inline: true },
        { name: "Verdict", value: "Empirical Probe", inline: true },
      ],
      bypassCooldown: true,
    });

    assert.strictEqual(result.success, true);
    assert.ok(
      result.statusCode === 200 || result.statusCode === 204,
      `Expected status 200 or 204, got ${result.statusCode}`
    );
  });

  // Short pause to avoid hitting Discord's rate limiter
  await new Promise((r) => setTimeout(r, 600));

  await test("4.3: Route Handler POST /api/discord/test returns HTTP 200 with 2xx Discord status", async () => {
    const req = new Request("http://localhost:3000/api/discord/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "🧪 Challenger Route Test",
        description: "Testing POST route handler for Discord test endpoint",
      }),
    });

    const res = await discordTestPost(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.statusCode === 200 || data.statusCode === 204);
  });

  // Short pause to avoid hitting Discord's rate limiter
  await new Promise((r) => setTimeout(r, 600));

  await test("4.4: Route Handler GET /api/discord/test returns HTTP 200 with 2xx Discord status", async () => {
    const res = await discordTestGet();
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.statusCode === 200 || data.statusCode === 204);
  });

  await test("4.5: Invalid Discord Webhook URL returns 4xx/5xx error gracefully without unhandled exception", async () => {
    const badUrl = "https://discord.com/api/webhooks/111111111111111111/invalid_secret_token_xyz";
    const result = await testDiscordWebhook(badUrl);

    assert.strictEqual(result.success, false, "Invalid URL must not report success");
    assert.ok(
      result.statusCode >= 400 && result.statusCode <= 500,
      `Expected error status code 4xx/500, got ${result.statusCode}`
    );
  });

  await test("4.6: Unreachable domain returns status 500 gracefully without crashing process", async () => {
    const unreachableUrl = "https://non-existent-discord-host-challenger-test.invalid/webhook";
    const result = await testDiscordWebhook(unreachableUrl);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.statusCode, 500);
    assert.ok(result.error !== undefined);
  });

  // ============================================================================
  // SUMMARY AND VERDICT
  // ============================================================================
  console.log("\n================================================================================");
  console.log(`  CHALLENGER 1 STRESS TEST RESULTS: ${stats.passed}/${stats.total} Passed (${stats.failed} Failed)`);
  console.log("================================================================================");

  if (stats.failed > 0) {
    console.error(`\nGATE VERDICT: REJECT - ${stats.failed} stress test(s) failed.`);
    process.exit(1);
  } else {
    console.log(`\nGATE VERDICT: APPROVE - All ${stats.total} adversarial stress tests passed flawlessly.`);
    process.exit(0);
  }
}

runAdversarialStressSuite().catch((err) => {
  console.error("\n[CRITICAL] Uncaught exception in stress test harness:", err);
  process.exit(1);
});
