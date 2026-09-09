/**
 * Milestone 8 Adversarial Probe & Stress Suite
 * Challenger 2 (teamwork_preview_challenger)
 *
 * Probes:
 * 1. Background execution lifecycle, concurrency, tracking, and log consistency
 * 2. Real host PM2 trigger vs simulated fallback and process state mutation
 * 3. Discord API schema compliance (limits, color ranges, fields, ISO timestamps)
 * 4. Live Discord webhook execution & network fault tolerance
 * 5. Vital threshold boundary conditions and 10-minute cooldown isolation
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import crypto from "crypto";

import {
  triggerDeployment,
  executeDeployment,
  getDeployments,
  getDeploymentById,
  clearDeploymentHistory,
  waitForDeployment,
  extractBranch,
} from "../src/lib/deploy-service";

import {
  POST as deployWebhookPost,
  GET as deployWebhookGet,
} from "../src/app/api/deploy/webhook/route";

import {
  getMockProcesses,
  executePM2Action,
} from "../src/lib/pm2-service";

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

async function runAdversarialProbes() {
  console.log("==================================================================");
  console.log("  Milestone 8 Adversarial Challenge & Stress Test Suite           ");
  console.log("==================================================================\n");

  let passed = 0;
  let total = 0;

  async function probe(name: string, fn: () => void | Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`  ✓ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ [FAIL] ${name}`);
      console.error(`    Error: ${err.message}`);
      if (err.stack) {
        console.error(`    Stack: ${err.stack.split("\n").slice(1, 3).join("\n")}`);
      }
      throw err;
    }
  }

  // ==========================================================================
  // AREA 1: Background Execution Lifecycle & Concurrency Tracking
  // ==========================================================================
  console.log("--- Area 1: Background Execution Tracking & Concurrency ---");

  await probe("Concurrent deployment dispatch manages independent state and history", async () => {
    clearDeploymentHistory();
    const CONCURRENCY = 5;
    const requests = Array.from({ length: CONCURRENCY }).map((_, i) => ({
      ref: "refs/heads/main",
      repository: { name: `repo-worker-${i}` },
      commits: [
        {
          id: `sha-concurrent-${i}`,
          message: `Concurrent commit ${i}`,
          author: { name: `Worker-${i}`, email: `w${i}@test.com` },
        },
      ],
    }));

    const responses = await Promise.all(
      requests.map((p) =>
        deployWebhookPost(
          new Request("http://localhost:3000/api/deploy/webhook", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(p),
          })
        )
      )
    );

    // Verify all return 202 Accepted immediately
    for (const res of responses) {
      assert.strictEqual(res.status, 202, "Each concurrent deployment must return 202");
    }

    const dataList = await Promise.all(responses.map((r) => r.json()));
    const deploymentIds = dataList.map((d) => d.deploymentId);

    // Verify unique IDs
    const uniqueIds = new Set(deploymentIds);
    assert.strictEqual(uniqueIds.size, CONCURRENCY, "Every concurrent deployment must have a unique ID");

    // Await all background jobs to finish
    const finishedDeployments = await Promise.all(
      deploymentIds.map((id) => waitForDeployment(id, 15000))
    );

    for (const dep of finishedDeployments) {
      assert.strictEqual(dep.status, "success", `Deployment ${dep.id} must complete successfully`);
      assert.strictEqual(dep.gitPullExecuted, true, `Deployment ${dep.id} gitPullExecuted must be true`);
      assert.strictEqual(dep.pm2RestartExecuted, true, `Deployment ${dep.id} pm2RestartExecuted must be true`);
      assert.ok(dep.durationMs !== undefined && dep.durationMs >= 0, "durationMs must be tracked");
      assert.ok(dep.completedAt !== undefined && dep.completedAt >= dep.startedAt);
      assert.ok(dep.logs.length >= 3, "Logs must record start, steps, and completion");
    }

    // Verify history storage
    const allHistory = getDeployments();
    for (const id of deploymentIds) {
      assert.ok(getDeploymentById(id), `Deployment ${id} must be retrievable from history`);
    }
  });

  await probe("Deployment status tracking exposes in-progress and log states", async () => {
    clearDeploymentHistory();
    const payload = {
      ref: "refs/heads/main",
      repository: { name: "state-tracking-test" },
    };

    const { deployment, promise } = triggerDeployment(payload);

    // Immediately after trigger, status should be pending or in_progress
    const current = getDeploymentById(deployment.id);
    assert.ok(current, "Queued deployment must be immediately in history");
    assert.ok(["pending", "in_progress", "success"].includes(current.status));
    assert.strictEqual(current.branch, "main");
    assert.strictEqual(current.repository?.name, "state-tracking-test");
    assert.ok(Array.isArray(current.logs) && current.logs.length > 0);

    const completed = await promise;
    assert.strictEqual(completed.status, "success");
    assert.strictEqual(completed.gitPullExecuted, true);
    assert.strictEqual(completed.pm2RestartExecuted, true);
  });

  await probe("Branch extraction handles deep branch paths and malicious formatting", () => {
    assert.strictEqual(extractBranch({ ref: "refs/heads/feature/enterprise/auth-v2" }), "feature/enterprise/auth-v2");
    assert.strictEqual(extractBranch({ ref: "refs/heads/release/2026.09.09" }), "release/2026.09.09");
    assert.strictEqual(extractBranch({ branch: "staging-hotfix" }), "staging-hotfix");
    assert.strictEqual(extractBranch({ ref: "refs/heads/../../etc/passwd" }), "../../etc/passwd");
    assert.strictEqual(extractBranch(null), "main");
    assert.strictEqual(extractBranch(undefined), "main");
    assert.strictEqual(extractBranch({}), "main");
  });

  await probe("Non-target branch pushes are rejected cleanly without spawning deployment", async () => {
    clearDeploymentHistory();
    const req = new Request("http://localhost:3000/api/deploy/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: "refs/heads/unrelated-experimental-branch",
        repository: { name: "test-repo" },
      }),
    });

    const res = await deployWebhookPost(req);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.deployed, false);
    assert.strictEqual(getDeployments().length, 0, "No deployment must be queued");
  });

  // ==========================================================================
  // AREA 2: Host CLI vs Simulated PM2 Fallback Verification
  // ==========================================================================
  console.log("\n--- Area 2: Host CLI vs Simulated PM2 Fallback ---");

  await probe("PM2 restart properly mutates process state on simulated fallback", async () => {
    const mockProcs = getMockProcesses();
    const targetProc = mockProcs[0];
    const initialRestarts = targetProc.restarts;

    // Simulate direct deployment execution
    clearDeploymentHistory();
    const deploymentRecord = {
      id: "dep-test-pm2-fallback",
      timestamp: new Date().toISOString(),
      branch: "main",
      status: "pending" as const,
      mode: "real" as const,
      logs: [],
      startedAt: Date.now(),
      gitPullExecuted: false,
      pm2RestartExecuted: false,
    };
    getDeployments().push(deploymentRecord);

    const result = await executeDeployment("dep-test-pm2-fallback", {
      ref: "refs/heads/main",
    });

    assert.strictEqual(result.pm2RestartExecuted, true);
    assert.ok(targetProc.restarts >= initialRestarts + 1, "Mock process restarts count must increment");
    assert.strictEqual(targetProc.status, "online", "Target process status must be online");
    assert.ok(result.logs.some((l) => l.toLowerCase().includes("pm2 restart")));
  });

  await probe("executePM2Action handles invalid actions, invalid IDs, and injection attempts", async () => {
    // 1. Invalid action
    const badAction = await executePM2Action("destroy", 0);
    assert.strictEqual(badAction.success, false);
    assert.strictEqual(badAction.statusCode, 400);

    // 2. Missing ID
    const noId = await executePM2Action("restart", null);
    assert.strictEqual(noId.success, false);
    assert.strictEqual(noId.statusCode, 400);

    // 3. Shell injection attempt
    const injection = await executePM2Action("restart", "0; rm -rf /");
    assert.strictEqual(injection.success, false);
    assert.strictEqual(injection.statusCode, 400);

    // 4. Valid action
    const valid = await executePM2Action("restart", 0);
    assert.strictEqual(valid.success, true);
  });

  // ==========================================================================
  // AREA 3: Discord API Schema Conformance & Embed Limits
  // ==========================================================================
  console.log("\n--- Area 3: Discord API Schema Conformance ---");

  await probe("Discord embed colors conform to Discord API 24-bit integer limits (0 to 16777215)", () => {
    const colorValues = Object.values(ALERT_COLORS);
    for (const color of colorValues) {
      assert.ok(
        Number.isInteger(color) && color >= 0 && color <= 0xffffff,
        `Color ${color} must be a valid 24-bit RGB integer (0..16777215)`
      );
    }

    // Verify resolveColor mappings
    assert.strictEqual(resolveColor("crash"), 15158332);
    assert.strictEqual(resolveColor("cpu_spike"), 15105570);
    assert.strictEqual(resolveColor("test"), 3447003);
    assert.strictEqual(resolveColor("success"), 3066993);
    assert.strictEqual(resolveColor(undefined, 12345), 12345);
  });

  await probe("Discord payload matches Discord Webhook API constraints", async () => {
    // Verify constraints:
    // title <= 256 chars, description <= 4096 chars, fields <= 25,
    // field name <= 256 chars, field value <= 1024 chars, footer <= 2048 chars
    clearAlertCooldowns();

    const complexAlert = {
      title: "🔥 Severe Process Incident Alert",
      description: "Automated alert generated by Nexus Server Monitor for empirical schema verification.",
      level: "crash" as const,
      fields: [
        { name: "Process", value: "payment-gateway", inline: true },
        { name: "Exit Code", value: "137 (SIGKILL / OOM)", inline: true },
        { name: "CPU Utilization", value: "98.7%", inline: true },
        { name: "Memory Consumed", value: "1024.5 MB", inline: true },
        { name: "Incident ID", value: "inc-" + Date.now(), inline: false },
      ],
      bypassCooldown: true,
    };

    // Assert schema pre-flight
    assert.ok(complexAlert.title.length <= 256);
    assert.ok(complexAlert.description.length <= 4096);
    assert.ok(complexAlert.fields.length <= 25);
    for (const f of complexAlert.fields) {
      assert.ok(f.name.length > 0 && f.name.length <= 256);
      assert.ok(f.value.length > 0 && f.value.length <= 1024);
    }

    // Live dispatch to Discord API
    const result = await sendDiscordAlert(complexAlert);
    assert.strictEqual(result.success, true, "Complex schema alert must be accepted by Discord");
    assert.ok(
      result.statusCode >= 200 && result.statusCode < 300,
      `Discord API returned ${result.statusCode}`
    );
    console.log(`    (Live Discord response code: ${result.statusCode})`);
  });

  // ==========================================================================
  // AREA 4: Cooldown Isolation, Vitals Detection, & Error Resilience
  // ==========================================================================
  console.log("\n--- Area 4: Cooldown Isolation, Vitals Detection & Fault Tolerance ---");

  await probe("Cooldown isolates different process names and respects bypass flag", async () => {
    clearAlertCooldowns();

    // Alert 1: proc-alpha
    const r1 = await sendDiscordAlert({
      title: "Alert Alpha",
      description: "Crash on alpha",
      level: "crash",
      processName: "proc-alpha",
    });
    assert.strictEqual(r1.success, true);

    // Alert 2: proc-alpha duplicate (throttled)
    const r2 = await sendDiscordAlert({
      title: "Alert Alpha Dup",
      description: "Crash on alpha again",
      level: "crash",
      processName: "proc-alpha",
    });
    assert.strictEqual(r2.success, false);
    assert.strictEqual(r2.statusCode, 429);
    assert.strictEqual(r2.rateLimited, true);

    // Alert 3: proc-beta (different process -> MUST succeed)
    const r3 = await sendDiscordAlert({
      title: "Alert Beta",
      description: "Crash on beta",
      level: "crash",
      processName: "proc-beta",
    });
    assert.strictEqual(r3.success, true, "Different process name must NOT be blocked by other process cooldown");

    // Alert 4: proc-alpha with bypassCooldown (MUST succeed)
    const r4 = await sendDiscordAlert({
      title: "Alert Alpha Emergency",
      description: "Critical bypass alert",
      level: "crash",
      processName: "proc-alpha",
      bypassCooldown: true,
    });
    assert.strictEqual(r4.success, true, "bypassCooldown=true must bypass the cooldown throttle");

    clearAlertCooldowns();
  });

  await probe("checkVitalsAndAlert correctly discriminates CPU 80% boundary and stopped states", async () => {
    clearAlertCooldowns();

    const procs = [
      // 1. Online, CPU exactly 80.0% -> NOT a spike (>80.0%)
      { id: 10, name: "proc-border-80", status: "online", cpu: 80.0, memory: 1000000, restarts: 0 },
      // 2. Online, CPU 80.1% -> SPIKE (>80.0%)
      { id: 11, name: "proc-spike-80.1", status: "online", cpu: 80.1, memory: 1000000, restarts: 0 },
      // 3. Stopped, restarts = 0 -> clean planned stop, NOT a crash
      { id: 12, name: "proc-clean-stop", status: "stopped", cpu: 0, memory: 0, restarts: 0 },
      // 4. Stopped, restarts = 2 -> crash restart failure, IS a crash
      { id: 13, name: "proc-unclean-stop", status: "stopped", cpu: 0, memory: 0, restarts: 2 },
      // 5. Errored -> IS a crash
      { id: 14, name: "proc-errored", status: "errored", cpu: 0, memory: 0, restarts: 1 },
    ];

    const alerts = await checkVitalsAndAlert(procs);

    // Expect 3 alerts: proc-spike-80.1 (cpu), proc-unclean-stop (crash), proc-errored (crash)
    assert.strictEqual(alerts.length, 3, `Expected 3 alerts, got ${alerts.length}`);
    assert.ok(alerts.every((a) => a.success && a.statusCode >= 200 && a.statusCode < 300));

    clearAlertCooldowns();
  });

  await probe("Fault tolerance: invalid Discord URL or network rejection does not throw unhandled error", async () => {
    // 1. Malformed webhook URL
    const badUrlResult = await sendDiscordAlert({
      title: "Test Bad URL",
      description: "Should fail gracefully",
      url: "https://discord.com/api/webhooks/999999999999999999/invalid_token_xyz_not_real",
      bypassCooldown: true,
    });

    assert.strictEqual(badUrlResult.success, false);
    assert.ok(badUrlResult.statusCode >= 400);

    // 2. Unreachable domain
    const unreachableResult = await sendDiscordAlert({
      title: "Test Unreachable",
      description: "Domain unreachable",
      url: "http://127.0.0.1:59999/nonexistent-webhook",
      bypassCooldown: true,
    });

    assert.strictEqual(unreachableResult.success, false);
    assert.strictEqual(unreachableResult.statusCode, 500);
    assert.ok(unreachableResult.error !== undefined);
  });

  await probe("Discord test route handlers POST and GET return HTTP 200 with 2xx live status", async () => {
    // GET handler
    const getRes = await discordTestGet();
    assert.strictEqual(getRes.status, 200);
    const getData = await getRes.json();
    assert.strictEqual(getData.success, true);
    assert.ok(getData.statusCode >= 200 && getData.statusCode < 300);

    // POST handler with custom title/description
    const postReq = new Request("http://localhost:3000/api/discord/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "🧪 Challenger Custom Test",
        description: "Adversarial test dispatch verification",
        level: "test",
      }),
    });
    const postRes = await discordTestPost(postReq);
    assert.strictEqual(postRes.status, 200);
    const postData = await postRes.json();
    assert.strictEqual(postData.success, true);
    assert.ok(postData.statusCode >= 200 && postData.statusCode < 300);
  });

  console.log("\n==================================================================");
  console.log(`  All ${total} Milestone 8 Adversarial Probes passed! (${passed}/${total})`);
  console.log("==================================================================\n");
}

runAdversarialProbes().catch((err) => {
  console.error("\nAdversarial probe suite encountered an error:", err);
  process.exit(1);
});
