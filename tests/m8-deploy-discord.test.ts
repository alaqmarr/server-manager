/**
 * Milestone 8: Git Auto-Deployments & Discord Alerts Test Suite
 *
 * Requirements Tested:
 * 1. POST /api/deploy/webhook accepts simulated & real GitHub push payloads
 * 2. Webhook responds immediately (200/202) with deployment ticket and triggers background git pull & PM2 restart
 * 3. Graceful fallback on environments without git remote or PM2 CLI (mock execution with incremented restart counters)
 * 4. GitHub ping events acknowledged without triggering deployment
 * 5. Branch filtering ignores non-target branches
 * 6. Method guards return 405 for non-POST requests on /api/deploy/webhook
 * 7. Malformed payloads return 400 Bad Request
 * 8. Optional HMAC signature validation (valid -> accepted, invalid -> 401)
 * 9. Discord service sends rich embeds using native fetch
 * 10. Discord alert cooldown enforces 10-minute throttle per process
 * 11. Discord checkVitalsAndAlert detects crashes and CPU spikes > 80%
 * 12. Discord testDiscordWebhook() returns a 2xx status code from Discord API
 * 13. POST /api/discord/test route handler returns 2xx status code
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import crypto from "crypto";

// Deployment Service and Route
import {
  triggerDeployment,
  executeDeployment,
  getDeployments,
  getDeploymentById,
  clearDeploymentHistory,
  waitForDeployment,
  extractBranch,
  acquireDeploymentLock,
  releaseDeploymentLock,
  isDeploymentLocked,
} from "../src/lib/deploy-service";
import {
  POST as deployWebhookPost,
  GET as deployWebhookGet,
  PUT as deployWebhookPut,
  DELETE as deployWebhookDelete,
} from "../src/app/api/deploy/webhook/route";

// PM2 Service Mock Store
import { getMockProcesses } from "../src/lib/pm2-service";

// Discord Service and Route
import {
  sendDiscordAlert,
  testDiscordWebhook,
  checkVitalsAndAlert,
  clearAlertCooldowns,
  getAlertCooldowns,
  AUTHORITATIVE_DISCORD_WEBHOOK_URL,
  ALERT_COLORS,
} from "../src/lib/discord-service";
import {
  POST as discordTestPost,
  GET as discordTestGet,
} from "../src/app/api/discord/test/route";

async function runTests() {
  console.log("==================================================================");
  console.log("  Milestone 8: Git Auto-Deployments & Discord Alerts Test Suite   ");
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
  // SECTION 1: Discord Alerts Webhook Service
  // --------------------------------------------------------------------------
  console.log("--- Section 1: Discord Alerts Webhook Service ---");

  await test("Authoritative Discord Webhook URL is correctly configured", () => {
    assert.strictEqual(
      AUTHORITATIVE_DISCORD_WEBHOOK_URL,
      "https://discord.com/api/webhooks/1547135127182639125/g4BMcJ7KS4y_YcNyc1sfrNuR5Af5R2xcQt0wDnsQw9_tYv6Uv2zJTzeUKeyiDN6EZpgB"
    );
  });

  await test("Embed colors conform to specification (Red crash, Orange CPU, Blue test, Green success)", () => {
    assert.strictEqual(ALERT_COLORS.crash, 15158332, "Crash must be Red (15158332)");
    assert.strictEqual(ALERT_COLORS.error, 15158332, "Error must be Red (15158332)");
    assert.strictEqual(ALERT_COLORS.cpu_spike, 15105570, "CPU spike must be Orange (15105570)");
    assert.strictEqual(ALERT_COLORS.warning, 15105570, "Warning must be Orange (15105570)");
    assert.strictEqual(ALERT_COLORS.test, 3447003, "Test must be Blue (3447003)");
    assert.strictEqual(ALERT_COLORS.info, 3447003, "Info must be Blue (3447003)");
    assert.strictEqual(ALERT_COLORS.success, 3066993, "Success must be Green (3066993)");
  });

  await test("Acceptance Criterion: testDiscordWebhook() returns a 2xx status code from Discord API", async () => {
    const result = await testDiscordWebhook();
    assert.strictEqual(result.success, true, "Discord webhook dispatch must succeed");
    assert.ok(
      result.statusCode >= 200 && result.statusCode < 300,
      `Expected 2xx status code from Discord API, got ${result.statusCode}`
    );
    console.log(`    (Discord API returned status ${result.statusCode})`);
  });

  await test("POST /api/discord/test route handler returns 2xx response", async () => {
    const req = new Request("http://localhost:3000/api/discord/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await discordTestPost(req);
    assert.strictEqual(res.status, 200, "Route response status must be 200");
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.statusCode >= 200 && data.statusCode < 300);
  });

  await test("GET /api/discord/test route handler also succeeds with 2xx", async () => {
    const res = await discordTestGet();
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.statusCode >= 200 && data.statusCode < 300);
  });

  await test("Alert cooldown enforces 10-minute suppression per process", async () => {
    clearAlertCooldowns();

    // First alert for test-proc should succeed
    const firstAlert = await sendDiscordAlert({
      title: "🚨 Test Alert: Crash",
      description: "First crash alert for test-proc",
      level: "crash",
      processName: "test-proc-cooldown",
      fields: [{ name: "Status", value: "errored" }],
    });
    assert.strictEqual(firstAlert.success, true, "First alert must succeed");
    assert.ok(firstAlert.statusCode >= 200 && firstAlert.statusCode < 300);

    // Second alert for same process immediately after should be throttled by cooldown
    const secondAlert = await sendDiscordAlert({
      title: "🚨 Test Alert: Crash Duplicate",
      description: "Immediate duplicate alert for test-proc",
      level: "crash",
      processName: "test-proc-cooldown",
    });
    assert.strictEqual(secondAlert.success, false, "Second alert must be suppressed by cooldown");
    assert.strictEqual(secondAlert.statusCode, 429, "Expected 429 status for throttled alert");
    assert.strictEqual(secondAlert.rateLimited, true);

    // Alert with bypassCooldown=true should bypass cooldown
    const bypassAlert = await sendDiscordAlert({
      title: "🚨 Test Alert: Bypass Cooldown",
      description: "Bypassed alert",
      level: "crash",
      processName: "test-proc-cooldown",
      bypassCooldown: true,
    });
    assert.strictEqual(bypassAlert.success, true, "Bypassed alert must succeed");
    assert.ok(bypassAlert.statusCode >= 200 && bypassAlert.statusCode < 300);

    clearAlertCooldowns();
  });

  await test("checkVitalsAndAlert triggers alerts on errored processes and CPU spikes > 80%", async () => {
    clearAlertCooldowns();

    const sampleProcesses = [
      {
        id: 0,
        name: "proc-healthy",
        status: "online",
        cpu: 15.0,
        memory: 50 * 1024 * 1024,
        restarts: 0,
      },
      {
        id: 1,
        name: "proc-errored-test",
        status: "errored",
        cpu: 0,
        memory: 10 * 1024 * 1024,
        restarts: 3,
      },
      {
        id: 2,
        name: "proc-cpu-spike-test",
        status: "online",
        cpu: 92.5,
        memory: 120 * 1024 * 1024,
        restarts: 0,
      },
    ];

    const alerts = await checkVitalsAndAlert(sampleProcesses);
    assert.strictEqual(alerts.length, 2, "Expected 2 alerts (1 crash + 1 CPU spike)");
    assert.ok(alerts.every((a) => a.success && a.statusCode >= 200 && a.statusCode < 300));

    clearAlertCooldowns();
  });

  // --------------------------------------------------------------------------
  // SECTION 2: Git Auto-Deployments Webhook
  // --------------------------------------------------------------------------
  console.log("\n--- Section 2: Git Auto-Deployments Webhook ---");

  await test("extractBranch correctly extracts branch name from git ref and payload", () => {
    assert.strictEqual(extractBranch({ ref: "refs/heads/main" }), "main");
    assert.strictEqual(extractBranch({ ref: "refs/heads/production" }), "production");
    assert.strictEqual(extractBranch({ branch: "staging" }), "staging");
    assert.strictEqual(extractBranch({}), "main");
  });

  await test("Acceptance Criterion: Sending a simulated GitHub push payload triggers background git pull, build, and PM2 restart", async () => {
    clearDeploymentHistory();
    const mockProcs = getMockProcesses();
    const initialRestarts = mockProcs[0].restarts;

    const simulatedPayload = {
      ref: "refs/heads/main",
      repository: {
        name: "server-manager",
        full_name: "alaqmarr/server-manager",
      },
      commits: [
        {
          id: "c8e2b10f9a",
          message: "feat: enterprise auto-deployments verification",
          author: {
            name: "Test Auditor",
            email: "auditor@test.local",
          },
          timestamp: new Date().toISOString(),
        },
      ],
      head_commit: {
        id: "c8e2b10f9a",
        message: "feat: enterprise auto-deployments verification",
        author: {
          name: "Test Auditor",
          email: "auditor@test.local",
        },
      },
    };

    const req = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "push",
      },
      body: JSON.stringify(simulatedPayload),
    });

    // 1. Verify immediate response
    const startTime = Date.now();
    const response = await deployWebhookPost(req);
    const responseTime = Date.now() - startTime;

    assert.ok(
      response.status === 200 || response.status === 202,
      `Expected HTTP 200 or 202, got ${response.status}`
    );
    assert.ok(responseTime < 1000, `Immediate response took ${responseTime}ms, expected <1000ms`);

    const data = await response.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.message, "Deployment triggered");
    assert.ok(typeof data.deploymentId === "string" && data.deploymentId.length > 0);
    assert.strictEqual(data.branch, "main");

    // 2. Wait for background execution to complete
    const deployment = await waitForDeployment(data.deploymentId, 15000);
    assert.strictEqual(deployment.status, "success", "Deployment status must reach 'success'");
    assert.strictEqual(deployment.gitPullExecuted, true, "gitPullExecuted must be true");
    assert.strictEqual(deployment.buildExecuted, true, "buildExecuted must be true");
    assert.strictEqual(deployment.pm2RestartExecuted, true, "pm2RestartExecuted must be true");

    // 3. Verify PM2 restart occurred (either real or mock process restart count incremented)
    const finalRestarts = mockProcs[0].restarts;
    assert.ok(
      finalRestarts >= initialRestarts + 1 || deployment.logs.some((l) => l.includes("PM2 Restart")),
      "PM2 restart execution must be reflected in process restart counters or logs"
    );

    // 4. Verify logs detail git pull, build, and PM2 restart
    assert.ok(
      deployment.logs.some((l) => l.includes("git pull") || l.includes("Git Pull")),
      "Deployment logs must contain git pull execution"
    );
    assert.ok(
      deployment.logs.some((l) => l.includes("build") || l.includes("Build")),
      "Deployment logs must contain build execution"
    );
    assert.ok(
      deployment.logs.some((l) => l.includes("PM2") || l.includes("pm2")),
      "Deployment logs must contain PM2 restart execution"
    );

    console.log(`    (Deployment ${deployment.id} finished in ${deployment.durationMs}ms in mode '${deployment.mode}')`);
  });

  await test("GitHub Ping event returns 200 OK without triggering deployment", async () => {
    clearDeploymentHistory();

    const pingPayload = {
      zen: "Approachable is better than simple.",
      hook_id: 12345678,
    };

    const req = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "ping",
      },
      body: JSON.stringify(pingPayload),
    });

    const response = await deployWebhookPost(req);
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.message.includes("Pong"));
    assert.strictEqual(data.zen, "Approachable is better than simple.");

    // Assert no deployment was queued
    assert.strictEqual(getDeployments().length, 0, "Ping should not trigger a deployment");
  });

  await test("Push to non-target branch is ignored gracefully (supports ref and branch properties)", async () => {
    clearDeploymentHistory();

    // 1. Non-target branch via ref
    const devPayload = {
      ref: "refs/heads/feature/random-experimental",
      repository: { name: "server-manager" },
      commits: [{ id: "123", message: "dev commit" }],
    };

    const req = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(devPayload),
    });

    const response = await deployWebhookPost(req);
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.deployed, false);
    assert.ok(data.message.includes("does not match target branch"));

    // 2. Non-target branch via direct branch property
    const directBranchPayload = {
      branch: "feature-unwanted",
      repository: { name: "server-manager" },
    };

    const directReq = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(directBranchPayload),
    });

    const directRes = await deployWebhookPost(directReq);
    assert.strictEqual(directRes.status, 200);
    const directData = await directRes.json();
    assert.strictEqual(directData.success, true);
    assert.strictEqual(directData.deployed, false);
    assert.ok(directData.message.includes("does not match target branch"));

    // 3. Target branch via direct branch property
    const targetBranchPayload = {
      branch: "main",
      repository: { name: "server-manager" },
    };

    const targetReq = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(targetBranchPayload),
    });

    const targetRes = await deployWebhookPost(targetReq);
    assert.strictEqual(targetRes.status, 202);
    const targetData = await targetRes.json();
    assert.strictEqual(targetData.success, true);
    assert.strictEqual(targetData.branch, "main");

    clearDeploymentHistory();
  });

  await test("Empty body returns HTTP 400 Bad Request", async () => {
    const req = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });

    const response = await deployWebhookPost(req);
    assert.strictEqual(response.status, 400);
    const data = await response.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.error.includes("Invalid JSON"));
  });

  await test("Malformed JSON body returns HTTP 400 Bad Request", async () => {
    const req = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json ... }",
    });

    const response = await deployWebhookPost(req);
    assert.strictEqual(response.status, 400);
    const data = await response.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.error.includes("Invalid JSON"));
  });

  await test("Non-POST methods return 405 Method Not Allowed with Allow: POST", async () => {
    const getRes = await deployWebhookGet();
    assert.strictEqual(getRes.status, 405);
    assert.strictEqual(getRes.headers.get("Allow"), "POST");

    const putRes = await deployWebhookPut();
    assert.strictEqual(putRes.status, 405);
    assert.strictEqual(putRes.headers.get("Allow"), "POST");

    const delRes = await deployWebhookDelete();
    assert.strictEqual(delRes.status, 405);
    assert.strictEqual(delRes.headers.get("Allow"), "POST");
  });

  await test("HMAC secret verification validates authentic signatures and rejects missing/tampered headers", async () => {
    const secret = "test_deploy_secret_key_12345";
    process.env.DEPLOY_WEBHOOK_SECRET = secret;

    try {
      const payloadStr = JSON.stringify({
        ref: "refs/heads/main",
        repository: { name: "test-repo" },
      });

      // 1. Missing signature header when secret is set must return HTTP 401
      const missingSigReq = new Request("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: payloadStr,
      });

      const missingSigRes = await deployWebhookPost(missingSigReq);
      assert.strictEqual(
        missingSigRes.status,
        401,
        "Must reject request missing signature header when secret is set"
      );
      const missingSigData = await missingSigRes.json();
      assert.strictEqual(missingSigData.success, false);
      assert.strictEqual(missingSigData.error, "Invalid webhook signature");

      // 2. Tampered signature must return HTTP 401
      const invalidReq = new Request("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": "sha256=tampered_invalid_signature_hex_00000000",
        },
        body: payloadStr,
      });

      const invalidRes = await deployWebhookPost(invalidReq);
      assert.strictEqual(invalidRes.status, 401);
      const invalidData = await invalidRes.json();
      assert.strictEqual(invalidData.success, false);
      assert.strictEqual(invalidData.error, "Invalid webhook signature");

      // 3. Valid signature must return HTTP 202
      const validHmac = crypto.createHmac("sha256", secret).update(payloadStr).digest("hex");
      const validReq = new Request("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": `sha256=${validHmac}`,
        },
        body: payloadStr,
      });

      const validRes = await deployWebhookPost(validReq);
      assert.strictEqual(validRes.status, 202);
      const validData = await validRes.json();
      assert.strictEqual(validData.success, true);
    } finally {
      delete process.env.DEPLOY_WEBHOOK_SECRET;
      clearDeploymentHistory();
    }
  });

  await test("Concurrency locking serializes simultaneous deployments without collisions", async () => {
    clearDeploymentHistory();

    const p1 = {
      ref: "refs/heads/main",
      repository: { name: "concurrent-repo-1" },
      commits: [{ id: "c1", message: "first concurrent commit" }],
    };
    const p2 = {
      ref: "refs/heads/main",
      repository: { name: "concurrent-repo-2" },
      commits: [{ id: "c2", message: "second concurrent commit" }],
    };

    const req1 = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p1),
    });
    const req2 = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p2),
    });

    const [res1, res2] = await Promise.all([deployWebhookPost(req1), deployWebhookPost(req2)]);
    assert.strictEqual(res1.status, 202);
    assert.strictEqual(res2.status, 202);

    const d1 = await res1.json();
    const d2 = await res2.json();

    const [dep1, dep2] = await Promise.all([
      waitForDeployment(d1.deploymentId, 15000),
      waitForDeployment(d2.deploymentId, 15000),
    ]);

    assert.strictEqual(dep1.status, "success");
    assert.strictEqual(dep1.gitPullExecuted, true);
    assert.strictEqual(dep1.buildExecuted, true);
    assert.strictEqual(dep1.pm2RestartExecuted, true);

    assert.strictEqual(dep2.status, "success");
    assert.strictEqual(dep2.gitPullExecuted, true);
    assert.strictEqual(dep2.buildExecuted, true);
    assert.strictEqual(dep2.pm2RestartExecuted, true);

    // Lock must be released after completion
    assert.strictEqual(isDeploymentLocked(), false, "Lock must be released after all deployments finish");

    clearDeploymentHistory();
  });

  console.log("\n==================================================================");
  console.log(`  All ${total} Milestone 8 tests passed successfully! (${passed}/${total})`);
  console.log("==================================================================\n");
}

runTests().catch((err) => {
  console.error("\nTest suite failed with uncaught exception:", err);
  process.exit(1);
});
