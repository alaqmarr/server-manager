/**
 * Adversarial Stress Test Suite for Milestone 6: RBAC Team Roles & Sensitive Route Protection
 * Challenger 2: Empirical Verification & Boundary Probing
 *
 * Requirements Covered:
 * 1. Attempting to insert a 2nd admin account directly via raw SQL & createUser() -> must throw SQLite error / fail.
 * 2. Attempting to update a developer to admin when an admin already exists -> must throw SQLite error / fail.
 * 3. Creating multiple developer accounts -> must succeed.
 * 4. Attempting to delete the last admin account via deleteUser() -> must fail/throw.
 * 5. Verifying public webhook /api/deploy/webhook is accessible without authentication headers.
 * 6. Adversarial edge cases: case insensitivity ('ADMIN', 'aDmIn'), API boundary enforcement, secret masking.
 */

import assert from "node:assert";
import bcrypt from "bcrypt";
import {
  db,
  createUser,
  getUserByUsername,
  listUsers,
  updateUserRole,
  deleteUser,
  adminExists,
} from "../src/lib/db";
import { authConfig } from "../src/auth.config";
import { requireAuth, requireAdmin } from "../src/lib/auth-guard";

// Sensitive route handlers
import { POST as terminalExecutePost } from "../src/app/api/terminal/execute/route";
import { GET as nginxFilesGet } from "../src/app/api/nginx/files/route";
import { GET as nginxContentGet } from "../src/app/api/nginx/content/route";
import { POST as nginxSavePost } from "../src/app/api/nginx/save/route";
import { GET as envGet, POST as envPost } from "../src/app/api/env/route";
import {
  GET as usersGet,
  POST as usersPost,
  PATCH as usersPatch,
  DELETE as usersDelete,
} from "../src/app/api/users/route";

interface ProbeResult {
  probeNumber: string;
  name: string;
  passed: boolean;
  details?: string;
}

const results: ProbeResult[] = [];

async function probe(probeNumber: string, name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ probeNumber, name, passed: true });
    console.log(`[PASS] Probe ${probeNumber}: ${name}`);
  } catch (err: any) {
    const errorDetails = err?.message || String(err);
    results.push({ probeNumber, name, passed: false, details: errorDetails });
    console.error(`[FAIL] Probe ${probeNumber}: ${name}`);
    console.error(`       Error: ${errorDetails}`);
  }
}

async function runChallenger2StressSuite() {
  console.log("================================================================================");
  console.log("CHALLENGER 2: ADVERSARIAL STRESS HARNESS - MILESTONE 6 RBAC & SECURITY");
  console.log("================================================================================\n");

  const initialAdminCountStmt = db.prepare(
    "SELECT count(*) as count FROM users WHERE LOWER(role) = 'admin'"
  );
  const initialAdminCount = (initialAdminCountStmt.get() as { count: number }).count;
  console.log(`Initial state: ${initialAdminCount} admin user(s) in database.\n`);

  // Ensure baseline admin exists
  if (initialAdminCount === 0) {
    const hash = await bcrypt.hash("InitialAdminPassword123!", 10);
    db.prepare("INSERT INTO users (username, passwordHash, role) VALUES (?, ?, 'admin')").run(
      "root_admin",
      hash
    );
    console.log("Created root_admin baseline account.");
  }

  // ---------------------------------------------------------------------------
  // PROBE GROUP 1: Single Admin Invariant & Trigger Enforcement on INSERT
  // ---------------------------------------------------------------------------
  console.log("--- PROBE GROUP 1: Single Admin Invariant & Trigger Enforcement on INSERT ---");

  await probe("1.1", "Direct raw SQL INSERT of 2nd admin throws SqliteError aborting transaction", () => {
    let thrownError: any = null;
    try {
      db.prepare(
        "INSERT INTO users (username, passwordHash, role) VALUES ('raw_second_admin', 'hash', 'admin')"
      ).run();
    } catch (err: any) {
      thrownError = err;
    }

    assert.ok(thrownError, "Expected direct raw SQL INSERT of 2nd admin to throw an error");
    assert.ok(
      thrownError.message.includes("Only one administrator account is permitted") ||
        thrownError.code === "SQLITE_CONSTRAINT" ||
        thrownError.message.includes("Admin already exists"),
      `Expected SQLite trigger abort message, got: ${thrownError.message}`
    );
  });

  await probe("1.2", "Direct raw SQL INSERT with uppercase 'ADMIN' triggers case-insensitive abort", () => {
    let thrownError: any = null;
    try {
      db.prepare(
        "INSERT INTO users (username, passwordHash, role) VALUES ('raw_upper_admin', 'hash', 'ADMIN')"
      ).run();
    } catch (err: any) {
      thrownError = err;
    }

    assert.ok(thrownError, "Expected raw SQL INSERT with role='ADMIN' to throw");
    assert.ok(
      thrownError.message.includes("Only one administrator account is permitted"),
      `Expected case-insensitive trigger abort, got: ${thrownError?.message}`
    );
  });

  await probe("1.3", "Direct raw SQL INSERT with mixed case 'aDmIn' triggers abort", () => {
    let thrownError: any = null;
    try {
      db.prepare(
        "INSERT INTO users (username, passwordHash, role) VALUES ('raw_mixed_admin', 'hash', 'aDmIn')"
      ).run();
    } catch (err: any) {
      thrownError = err;
    }

    assert.ok(thrownError, "Expected raw SQL INSERT with role='aDmIn' to throw");
    assert.ok(
      thrownError.message.includes("Only one administrator account is permitted"),
      `Expected case-insensitive trigger abort, got: ${thrownError?.message}`
    );
  });

  await probe("1.4", "createUser() helper fails when attempting to create a 2nd admin", async () => {
    const hash = await bcrypt.hash("admin2pass", 10);
    const created = createUser("helper_second_admin", hash, "admin");
    assert.strictEqual(
      created,
      false,
      "createUser() must return false when trigger rejects second admin"
    );
    const queried = getUserByUsername("helper_second_admin");
    assert.strictEqual(queried, null, "User must not have been persisted in database");
  });

  await probe("1.5", "createUser() helper fails with case variations of admin ('Admin')", async () => {
    const hash = await bcrypt.hash("admin2pass", 10);
    const created = createUser("helper_upper_admin", hash, "Admin");
    assert.strictEqual(created, false, "createUser() must return false for 'Admin'");
    const queried = getUserByUsername("helper_upper_admin");
    assert.strictEqual(queried, null, "User must not have been persisted in database");
  });

  // ---------------------------------------------------------------------------
  // PROBE GROUP 2: Admin Role Elevation Invariant & Trigger Enforcement on UPDATE
  // ---------------------------------------------------------------------------
  console.log("\n--- PROBE GROUP 2: Admin Role Elevation Invariant on UPDATE ---");

  const devHash = await bcrypt.hash("developerpass123", 10);
  createUser("dev_for_elevation_test", devHash, "developer");
  const devUser = getUserByUsername("dev_for_elevation_test");
  assert.ok(devUser, "Setup: Developer user for elevation test must exist");

  await probe("2.1", "Direct raw SQL UPDATE of developer to 'admin' throws SqliteError aborting transaction", () => {
    let thrownError: any = null;
    try {
      db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(devUser.id);
    } catch (err: any) {
      thrownError = err;
    }

    assert.ok(thrownError, "Expected raw SQL UPDATE to throw SqliteError");
    assert.ok(
      thrownError.message.includes("Only one administrator account is permitted"),
      `Expected 'one_admin_only_update' trigger abort, got: ${thrownError?.message}`
    );
  });

  await probe("2.2", "Direct raw SQL UPDATE of developer to uppercase 'ADMIN' throws SqliteError", () => {
    let thrownError: any = null;
    try {
      db.prepare("UPDATE users SET role = 'ADMIN' WHERE id = ?").run(devUser.id);
    } catch (err: any) {
      thrownError = err;
    }

    assert.ok(thrownError, "Expected raw SQL UPDATE with role='ADMIN' to throw");
    assert.ok(
      thrownError.message.includes("Only one administrator account is permitted"),
      `Expected trigger abort, got: ${thrownError?.message}`
    );
  });

  await probe("2.3", "updateUserRole() helper fails when elevating developer to admin", () => {
    const updated = updateUserRole(devUser.id, "admin");
    assert.strictEqual(updated, false, "updateUserRole() must return false when elevating to admin");

    const refreshed = getUserByUsername("dev_for_elevation_test");
    assert.strictEqual(refreshed?.role, "developer", "Role must remain 'developer'");
  });

  // ---------------------------------------------------------------------------
  // PROBE GROUP 3: Multiple Developer Account Creation & Scalability
  // ---------------------------------------------------------------------------
  console.log("\n--- PROBE GROUP 3: Multiple Developer Account Creation & Scalability ---");

  const devUsernames = [
    "c2_dev_alpha",
    "c2_dev_beta",
    "c2_dev_gamma",
    "c2_dev_delta",
    "c2_dev_epsilon",
  ];

  await probe("3.1", "Creating multiple distinct developer accounts succeeds sequentially", async () => {
    for (const username of devUsernames) {
      const created = createUser(username, devHash, "developer");
      assert.strictEqual(created, true, `Expected createUser to succeed for ${username}`);
      const user = getUserByUsername(username);
      assert.ok(user, `User ${username} must be queryable`);
      assert.strictEqual(user.role, "developer");
    }
  });

  await probe("3.2", "Database maintains exactly 1 admin while supporting multiple developers", () => {
    const adminCount = (
      db.prepare("SELECT count(*) as count FROM users WHERE LOWER(role) = 'admin'").get() as {
        count: number;
      }
    ).count;
    assert.strictEqual(adminCount, 1, "Admin count must remain exactly 1");

    const devCount = (
      db.prepare("SELECT count(*) as count FROM users WHERE LOWER(role) = 'developer'").get() as {
        count: number;
      }
    ).count;
    assert.ok(
      devCount >= devUsernames.length,
      `Expected at least ${devUsernames.length} developers, found ${devCount}`
    );
  });

  await probe("3.3", "listUsers() never exposes passwordHash in returned objects", () => {
    const allUsers = listUsers();
    assert.ok(allUsers.length >= devUsernames.length + 1);
    for (const u of allUsers) {
      assert.strictEqual(
        (u as any).passwordHash,
        undefined,
        `User ${u.username} exposed passwordHash`
      );
    }
  });

  // ---------------------------------------------------------------------------
  // PROBE GROUP 4: Last Admin Deletion Protection & Deletion Boundary
  // ---------------------------------------------------------------------------
  console.log("\n--- PROBE GROUP 4: Last Admin Deletion Protection & Deletion Boundary ---");

  const soleAdmin = db
    .prepare("SELECT id, username, role FROM users WHERE LOWER(role) = 'admin'")
    .get() as { id: number; username: string; role: string };
  assert.ok(soleAdmin, "Setup: Sole admin must exist");

  await probe("4.1", "deleteUser() refuses to delete the last remaining admin account", () => {
    const deleted = deleteUser(soleAdmin.id);
    assert.strictEqual(deleted, false, "deleteUser() must return false when attempting to delete last admin");

    const stillExists = db
      .prepare("SELECT id FROM users WHERE id = ?")
      .get(soleAdmin.id);
    assert.ok(stillExists, "Admin account must still exist in the database");
  });

  await probe("4.2", "deleteUser() allows deleting non-admin developer accounts", () => {
    const testDev = getUserByUsername(devUsernames[0]);
    assert.ok(testDev);
    const deleted = deleteUser(testDev.id);
    assert.strictEqual(deleted, true, "deleteUser() must return true for developer account");
    const queried = getUserByUsername(devUsernames[0]);
    assert.strictEqual(queried, null, "Developer account must be removed");
  });

  // ---------------------------------------------------------------------------
  // PROBE GROUP 5: Public Webhook Whitelist & Security Boundary
  // ---------------------------------------------------------------------------
  console.log("\n--- PROBE GROUP 5: Public Webhook Whitelist & Security Boundary ---");

  const authorized = authConfig.callbacks?.authorized;
  assert.ok(authorized, "authConfig.callbacks.authorized must be defined");

  await probe("5.1", "/api/deploy/webhook is accessible without authentication headers", () => {
    const req = {
      nextUrl: new URL("http://localhost:3000/api/deploy/webhook"),
    };
    const allowed = (authorized as any)({ auth: null, request: req });
    assert.strictEqual(allowed, true, "/api/deploy/webhook must return true for unauthenticated access");
  });

  await probe("5.2", "/api/deploy/webhook with subpaths and query parameters remains whitelisted", () => {
    const req = {
      nextUrl: new URL("http://localhost:3000/api/deploy/webhook?source=github&event=push"),
    };
    const allowed = (authorized as any)({ auth: null, request: req });
    assert.strictEqual(allowed, true, "Webhook with query parameters must remain whitelisted");
  });

  await probe("5.3", "Protected routes are denied (401) without authentication headers in proxy/middleware", async () => {
    const protectedPaths = [
      "http://localhost:3000/api/terminal/execute",
      "http://localhost:3000/api/nginx/files",
      "http://localhost:3000/api/nginx/content",
      "http://localhost:3000/api/nginx/save",
      "http://localhost:3000/api/env",
      "http://localhost:3000/api/users",
    ];

    for (const url of protectedPaths) {
      const req = { nextUrl: new URL(url) };
      const res = (authorized as any)({ auth: null, request: req });
      assert.ok(
        res instanceof Response || res === false,
        `Expected 401 Response or false for ${url}`
      );
      if (res instanceof Response) {
        assert.strictEqual(res.status, 401, `Path ${url} must return 401 status`);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // PROBE GROUP 6: Sensitive Route Handlers RBAC Enforcement
  // ---------------------------------------------------------------------------
  console.log("\n--- PROBE GROUP 6: Sensitive Route Handlers RBAC Enforcement ---");

  // Terminal Execution Route
  await probe("6.1", "POST /api/terminal/execute denies Developer (403)", async () => {
    const req = new Request("http://localhost:3000/api/terminal/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ command: "id" }),
    });
    const res = await terminalExecutePost(req);
    assert.strictEqual(res.status, 403);
  });

  await probe("6.2", "POST /api/terminal/execute denies Unauthenticated (401)", async () => {
    const req = new Request("http://localhost:3000/api/terminal/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "unauthenticated" },
      body: JSON.stringify({ command: "id" }),
    });
    const res = await terminalExecutePost(req);
    assert.strictEqual(res.status, 401);
  });

  // Nginx Configuration Routes
  await probe("6.3", "GET /api/nginx/files denies Developer (403)", async () => {
    const req = new Request("http://localhost:3000/api/nginx/files", {
      headers: { "x-mock-role": "developer" },
    });
    const res = await nginxFilesGet(req);
    assert.strictEqual(res.status, 403);
  });

  await probe("6.4", "GET /api/nginx/content denies Developer (403)", async () => {
    const req = new Request("http://localhost:3000/api/nginx/content?file=default", {
      headers: { "x-mock-role": "developer" },
    });
    const res = await nginxContentGet(req);
    assert.strictEqual(res.status, 403);
  });

  await probe("6.5", "POST /api/nginx/save denies Developer (403)", async () => {
    const req = new Request("http://localhost:3000/api/nginx/save", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ relativePath: "test.conf", content: "server {}" }),
    });
    const res = await nginxSavePost(req);
    assert.strictEqual(res.status, 403);
  });

  // Environment Variables Route
  await probe("6.6", "GET /api/env denies Developer (403)", async () => {
    const req = new Request("http://localhost:3000/api/env", {
      headers: { "x-mock-role": "developer" },
    });
    const res = await envGet(req);
    assert.strictEqual(res.status, 403);
  });

  await probe("6.7", "POST /api/env denies Developer (403)", async () => {
    const req = new Request("http://localhost:3000/api/env", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ action: "read", dirPath: "." }),
    });
    const res = await envPost(req);
    assert.strictEqual(res.status, 403);
  });

  await probe("6.8", "GET /api/env for Admin masks sensitive credentials", async () => {
    process.env.TEST_DB_PASSWORD = "SuperSecretDatabasePassword99!";
    const req = new Request("http://localhost:3000/api/env", {
      headers: { "x-mock-role": "admin" },
    });
    const res = await envGet(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    const found = data.envVars.find((v: any) => v.key === "TEST_DB_PASSWORD");
    assert.ok(found, "TEST_DB_PASSWORD must be returned");
    assert.strictEqual(found.masked, true);
    assert.ok(!found.value.includes("SecretDatabasePassword"), "Raw secret must not be exposed");
    assert.ok(found.value.includes("******"), "Secret value must contain mask asterisks");
  });

  // Users Management Route
  await probe("6.9", "GET /api/users denies Developer (403)", async () => {
    const req = new Request("http://localhost:3000/api/users", {
      headers: { "x-mock-role": "developer" },
    });
    const res = await usersGet(req);
    assert.strictEqual(res.status, 403);
  });

  await probe("6.10", "POST /api/users denies Developer (403)", async () => {
    const req = new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ username: "hack_dev", password: "password123", role: "developer" }),
    });
    const res = await usersPost(req);
    assert.strictEqual(res.status, 403);
  });

  await probe("6.11", "POST /api/users rejects Admin attempting to create a second admin (400)", async () => {
    const req = new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
      body: JSON.stringify({ username: "api_second_admin", password: "password123", role: "admin" }),
    });
    const res = await usersPost(req);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("Only one administrator account is permitted"));
  });

  await probe("6.12", "PATCH /api/users rejects Admin attempting to elevate developer to admin (400)", async () => {
    const targetDev = getUserByUsername("dev_for_elevation_test");
    assert.ok(targetDev);
    const req = new Request("http://localhost:3000/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
      body: JSON.stringify({ id: targetDev.id, role: "admin" }),
    });
    const res = await usersPatch(req);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("Only one administrator account is permitted"));
  });

  await probe("6.13", "DELETE /api/users rejects Admin attempting to delete sole admin account (400)", async () => {
    const req = new Request(`http://localhost:3000/api/users?id=${soleAdmin.id}`, {
      method: "DELETE",
      headers: { "x-mock-role": "admin" },
    });
    const res = await usersDelete(req);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("last administrator"));
  });

  // ---------------------------------------------------------------------------
  // CLEANUP TEST USERS
  // ---------------------------------------------------------------------------
  console.log("\n--- Cleaning up temporary test users ---");
  const cleanupUsernames = [
    "dev_for_elevation_test",
    ...devUsernames,
  ];

  for (const name of cleanupUsernames) {
    const user = getUserByUsername(name);
    if (user) {
      deleteUser(user.id);
    }
  }

  // Summary Report
  console.log("\n================================================================================");
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  console.log(`SUMMARY: ${passedCount}/${totalCount} PROBES PASSED`);
  console.log("================================================================================");

  if (passedCount < totalCount) {
    console.error("\nFAILED PROBES:");
    for (const r of results.filter((r) => !r.passed)) {
      console.error(` - Probe ${r.probeNumber} (${r.name}): ${r.details}`);
    }
    process.exit(1);
  } else {
    console.log("\nALL ADVERSARIAL STRESS PROBES PASSED CLEANLY.");
  }
}

runChallenger2StressSuite().catch((err) => {
  console.error("FATAL ERROR running stress suite:", err);
  process.exit(1);
});
