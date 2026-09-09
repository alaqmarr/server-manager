/**
 * Additional Adversarial Probes for Milestone 6: RBAC & Sensitive Route Protection
 * Challenger 2: Target-Specific Empirical Probing
 *
 * Specific Targets Mandated:
 * 1. Attempting to demote the sole admin to developer via raw SQL UPDATE -> verify trigger aborts.
 * 2. Attempting to delete the sole admin via raw SQL DELETE -> verify trigger aborts.
 * 3. Calling PATCH /api/users targeting the last admin -> verify returns HTTP 400 with clear error.
 * 4. Calling DELETE /api/users targeting the last admin -> verify returns HTTP 400.
 * 5. Remediated Nginx routes RBAC verification (create, toggle, test, ssl).
 * 6. Production mode backdoor neutralization check.
 * 7. System invariant & adminExists() preservation.
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
import { requireAuth, requireAdmin } from "../src/lib/auth-guard";

// Sensitive route handlers
import {
  PATCH as usersPatch,
  DELETE as usersDelete,
  GET as usersGet,
  POST as usersPost,
} from "../src/app/api/users/route";
import { POST as nginxCreatePost } from "../src/app/api/nginx/create/route";
import { POST as nginxTogglePost } from "../src/app/api/nginx/toggle/route";
import { POST as nginxTestPost } from "../src/app/api/nginx/test/route";
import { POST as nginxSslPost } from "../src/app/api/nginx/ssl/route";

interface ProbeRecord {
  id: string;
  name: string;
  passed: boolean;
  details?: string;
}

const probeRecords: ProbeRecord[] = [];

async function probe(id: string, name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    probeRecords.push({ id, name, passed: true });
    console.log(`[PASS] Probe ${id}: ${name}`);
  } catch (err: any) {
    const errorDetails = err?.message || String(err);
    probeRecords.push({ id, name, passed: false, details: errorDetails });
    console.error(`[FAIL] Probe ${id}: ${name}`);
    console.error(`       Error: ${errorDetails}`);
  }
}

async function runAdditionalAdversarialProbes() {
  console.log("================================================================================");
  console.log("CHALLENGER 2: ADDITIONAL ADVERSARIAL PROBES - SQLITE TRIGGERS & API BOUNDARIES");
  console.log("================================================================================\n");

  // Ensure baseline admin exists
  const initialAdminCountStmt = db.prepare(
    "SELECT count(*) as count FROM users WHERE LOWER(role) = 'admin'"
  );
  let initialAdminCount = (initialAdminCountStmt.get() as { count: number }).count;

  if (initialAdminCount === 0) {
    const hash = await bcrypt.hash("RootAdminPass123!", 10);
    db.prepare("INSERT INTO users (username, passwordHash, role) VALUES ('root_admin', ?, 'admin')").run(hash);
  }

  const soleAdmin = db
    .prepare("SELECT id, username, role FROM users WHERE LOWER(role) = 'admin'")
    .get() as { id: number; username: string; role: string };
  assert.ok(soleAdmin, "Setup prerequisite: Exactly one admin user must exist in the database");
  console.log(`Target Sole Admin: ID=${soleAdmin.id}, username='${soleAdmin.username}'\n`);

  // Create a disposable developer user for comparative testing
  const devHash = await bcrypt.hash("DevTestPass123!", 10);
  const devUsername = "adv_probe_test_dev";
  const existingDev = getUserByUsername(devUsername);
  if (existingDev) {
    deleteUser(existingDev.id);
  }
  createUser(devUsername, devHash, "developer");
  const testDev = getUserByUsername(devUsername);
  assert.ok(testDev, "Setup prerequisite: Test developer account must be created");

  // ---------------------------------------------------------------------------
  // TARGET 1: Demote sole admin to developer via raw SQL UPDATE -> trigger aborts
  // ---------------------------------------------------------------------------
  console.log("--- TARGET 1: Demote Sole Admin via Raw SQL UPDATE (Trigger Aborts) ---");

  await probe("T1.1", "Raw SQL UPDATE role='developer' on sole admin throws SQLITE_CONSTRAINT_TRIGGER", () => {
    let thrownError: any = null;
    try {
      db.prepare("UPDATE users SET role = 'developer' WHERE id = ?").run(soleAdmin.id);
    } catch (err: any) {
      thrownError = err;
    }

    assert.ok(thrownError, "Raw SQL UPDATE must throw an error");
    assert.strictEqual(
      thrownError.code,
      "SQLITE_CONSTRAINT_TRIGGER",
      `Expected SQLITE_CONSTRAINT_TRIGGER, got code: ${thrownError.code}`
    );
    assert.ok(
      thrownError.message.includes("Cannot demote the last remaining administrator"),
      `Expected 'Cannot demote the last remaining administrator', got: ${thrownError.message}`
    );

    // Verify role did not change
    const check = db.prepare("SELECT role FROM users WHERE id = ?").get(soleAdmin.id) as { role: string };
    assert.strictEqual(check.role.toLowerCase(), "admin", "Admin role must remain unchanged");
  });

  await probe("T1.2", "Raw SQL UPDATE role='DEVELOPER' (uppercase) on sole admin throws trigger abort", () => {
    let thrownError: any = null;
    try {
      db.prepare("UPDATE users SET role = 'DEVELOPER' WHERE id = ?").run(soleAdmin.id);
    } catch (err: any) {
      thrownError = err;
    }

    assert.ok(thrownError, "Raw SQL UPDATE must throw an error");
    assert.ok(
      thrownError.message.includes("Cannot demote the last remaining administrator"),
      `Expected trigger abort, got: ${thrownError?.message}`
    );
  });

  await probe("T1.3", "Raw SQL UPDATE role='dEvElOpEr' (mixed case) on sole admin throws trigger abort", () => {
    let thrownError: any = null;
    try {
      db.prepare("UPDATE users SET role = 'dEvElOpEr' WHERE id = ?").run(soleAdmin.id);
    } catch (err: any) {
      thrownError = err;
    }

    assert.ok(thrownError, "Raw SQL UPDATE must throw an error");
    assert.ok(
      thrownError.message.includes("Cannot demote the last remaining administrator"),
      `Expected trigger abort, got: ${thrownError?.message}`
    );
  });

  await probe("T1.4", "Raw SQL blanket UPDATE users SET role='developer' throws trigger abort", () => {
    let thrownError: any = null;
    try {
      db.prepare("UPDATE users SET role = 'developer'").run();
    } catch (err: any) {
      thrownError = err;
    }

    assert.ok(thrownError, "Blanket UPDATE must throw an error");
    assert.ok(
      thrownError.message.includes("Cannot demote the last remaining administrator"),
      `Expected trigger abort, got: ${thrownError?.message}`
    );
  });

  await probe("T1.5", "Raw SQL UPDATE users SET role='admin' on sole admin succeeds without false abort", () => {
    const info = db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(soleAdmin.id);
    assert.strictEqual(info.changes, 1, "Should update 1 row without trigger firing");
  });

  await probe("T1.6", "updateUserRole() helper returns false and does not alter sole admin role", () => {
    const updated = updateUserRole(soleAdmin.id, "developer");
    assert.strictEqual(updated, false, "updateUserRole() must return false for demoting last admin");
    const check = db.prepare("SELECT role FROM users WHERE id = ?").get(soleAdmin.id) as { role: string };
    assert.strictEqual(check.role.toLowerCase(), "admin", "Admin role must remain intact");
  });

  // ---------------------------------------------------------------------------
  // TARGET 2: Delete sole admin via raw SQL DELETE -> trigger aborts
  // ---------------------------------------------------------------------------
  console.log("\n--- TARGET 2: Delete Sole Admin via Raw SQL DELETE (Trigger Aborts) ---");

  await probe("T2.1", "Raw SQL DELETE WHERE id=? on sole admin throws SQLITE_CONSTRAINT_TRIGGER", () => {
    let thrownError: any = null;
    try {
      db.prepare("DELETE FROM users WHERE id = ?").run(soleAdmin.id);
    } catch (err: any) {
      thrownError = err;
    }

    assert.ok(thrownError, "Raw SQL DELETE must throw an error");
    assert.strictEqual(
      thrownError.code,
      "SQLITE_CONSTRAINT_TRIGGER",
      `Expected SQLITE_CONSTRAINT_TRIGGER, got code: ${thrownError.code}`
    );
    assert.ok(
      thrownError.message.includes("Cannot delete the last remaining administrator"),
      `Expected 'Cannot delete the last remaining administrator', got: ${thrownError.message}`
    );

    // Verify admin still exists
    const check = db.prepare("SELECT id FROM users WHERE id = ?").get(soleAdmin.id);
    assert.ok(check, "Admin account must still exist in the database");
  });

  await probe("T2.2", "Raw SQL DELETE WHERE username=? on sole admin throws trigger abort", () => {
    let thrownError: any = null;
    try {
      db.prepare("DELETE FROM users WHERE username = ?").run(soleAdmin.username);
    } catch (err: any) {
      thrownError = err;
    }

    assert.ok(thrownError, "Raw SQL DELETE by username must throw an error");
    assert.ok(
      thrownError.message.includes("Cannot delete the last remaining administrator"),
      `Expected trigger abort, got: ${thrownError?.message}`
    );
  });

  await probe("T2.3", "Raw SQL blanket DELETE FROM users throws trigger abort and rolls back", () => {
    let thrownError: any = null;
    try {
      db.prepare("DELETE FROM users").run();
    } catch (err: any) {
      thrownError = err;
    }

    assert.ok(thrownError, "Blanket DELETE must throw an error");
    assert.ok(
      thrownError.message.includes("Cannot delete the last remaining administrator"),
      `Expected trigger abort, got: ${thrownError?.message}`
    );

    // Verify sole admin is still present
    const check = db.prepare("SELECT id FROM users WHERE id = ?").get(soleAdmin.id);
    assert.ok(check, "Admin account must still exist after rolled back blanket DELETE");
  });

  await probe("T2.4", "deleteUser() helper rejects deleting sole admin", () => {
    const deleted = deleteUser(soleAdmin.id);
    assert.strictEqual(deleted, false, "deleteUser() must return false for sole admin");
    const check = db.prepare("SELECT id FROM users WHERE id = ?").get(soleAdmin.id);
    assert.ok(check, "Admin account must still exist");
  });

  await probe("T2.5", "Raw SQL DELETE of non-admin developer user succeeds", () => {
    const info = db.prepare("DELETE FROM users WHERE id = ?").run(testDev.id);
    assert.strictEqual(info.changes, 1, "Deleting developer must succeed");
    const check = db.prepare("SELECT id FROM users WHERE id = ?").get(testDev.id);
    assert.strictEqual(check, undefined, "Developer must be deleted");

    // Re-create testDev for subsequent API tests
    createUser(devUsername, devHash, "developer");
  });

  const refreshedDev = getUserByUsername(devUsername)!;

  // ---------------------------------------------------------------------------
  // TARGET 3: PATCH /api/users targeting last admin -> returns HTTP 400
  // ---------------------------------------------------------------------------
  console.log("\n--- TARGET 3: Calling PATCH /api/users Targeting Last Admin ---");

  await probe("T3.1", "PATCH /api/users with role='developer' targeting last admin returns HTTP 400", async () => {
    const req = new Request("http://localhost:3000/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
      body: JSON.stringify({ id: soleAdmin.id, role: "developer" }),
    });
    const res = await usersPatch(req);
    assert.strictEqual(res.status, 400, `Expected HTTP 400, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.error, "Cannot demote the last remaining administrator");

    // Verify DB role
    const check = db.prepare("SELECT role FROM users WHERE id = ?").get(soleAdmin.id) as { role: string };
    assert.strictEqual(check.role.toLowerCase(), "admin");
  });

  await probe("T3.2", "PATCH /api/users with role='Developer' (case variation) returns HTTP 400", async () => {
    const req = new Request("http://localhost:3000/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
      body: JSON.stringify({ id: soleAdmin.id, role: "Developer" }),
    });
    const res = await usersPatch(req);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.error, "Cannot demote the last remaining administrator");
  });

  await probe("T3.3", "PATCH /api/users with string ID stringified returns HTTP 400", async () => {
    const req = new Request("http://localhost:3000/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
      body: JSON.stringify({ id: String(soleAdmin.id), role: "developer" }),
    });
    const res = await usersPatch(req);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.error, "Cannot demote the last remaining administrator");
  });

  await probe("T3.4", "PATCH /api/users targeting last admin with role='admin' returns HTTP 200", async () => {
    const req = new Request("http://localhost:3000/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
      body: JSON.stringify({ id: soleAdmin.id, role: "admin" }),
    });
    const res = await usersPatch(req);
    assert.strictEqual(res.status, 200, `Expected HTTP 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true);
  });

  await probe("T3.5", "PATCH /api/users called by Developer returns HTTP 403 Forbidden", async () => {
    const req = new Request("http://localhost:3000/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ id: soleAdmin.id, role: "developer" }),
    });
    const res = await usersPatch(req);
    assert.strictEqual(res.status, 403, `Expected HTTP 403, got ${res.status}`);
  });

  await probe("T3.6", "PATCH /api/users unauthenticated returns HTTP 401 Unauthorized", async () => {
    const req = new Request("http://localhost:3000/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-mock-role": "unauthenticated" },
      body: JSON.stringify({ id: soleAdmin.id, role: "developer" }),
    });
    const res = await usersPatch(req);
    assert.strictEqual(res.status, 401, `Expected HTTP 401, got ${res.status}`);
  });

  // ---------------------------------------------------------------------------
  // TARGET 4: Calling DELETE /api/users targeting the last admin -> returns HTTP 400
  // ---------------------------------------------------------------------------
  console.log("\n--- TARGET 4: Calling DELETE /api/users Targeting Last Admin ---");

  await probe("T4.1", "DELETE /api/users?id=<adminId> via query param returns HTTP 400", async () => {
    const req = new Request(`http://localhost:3000/api/users?id=${soleAdmin.id}`, {
      method: "DELETE",
      headers: { "x-mock-role": "admin" },
    });
    const res = await usersDelete(req);
    assert.strictEqual(res.status, 400, `Expected HTTP 400, got ${res.status}`);
    const data = await res.json();
    assert.ok(
      data.error.includes("last remaining administrator") || data.error.includes("last administrator"),
      `Expected last administrator error message, got: ${data.error}`
    );

    // Verify admin still exists in DB
    const check = db.prepare("SELECT id FROM users WHERE id = ?").get(soleAdmin.id);
    assert.ok(check, "Admin user must not be deleted");
  });

  await probe("T4.2", "DELETE /api/users with body { id: adminId } returns HTTP 400", async () => {
    const req = new Request("http://localhost:3000/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
      body: JSON.stringify({ id: soleAdmin.id }),
    });
    const res = await usersDelete(req);
    assert.strictEqual(res.status, 400, `Expected HTTP 400, got ${res.status}`);
    const data = await res.json();
    assert.ok(
      data.error.includes("last remaining administrator") || data.error.includes("last administrator"),
      `Expected last administrator error message, got: ${data.error}`
    );
  });

  await probe("T4.3", "DELETE /api/users with stringified ID returns HTTP 400", async () => {
    const req = new Request("http://localhost:3000/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
      body: JSON.stringify({ id: String(soleAdmin.id) }),
    });
    const res = await usersDelete(req);
    assert.strictEqual(res.status, 400);
  });

  await probe("T4.4", "DELETE /api/users called by Developer returns HTTP 403 Forbidden", async () => {
    const req = new Request(`http://localhost:3000/api/users?id=${soleAdmin.id}`, {
      method: "DELETE",
      headers: { "x-mock-role": "developer" },
    });
    const res = await usersDelete(req);
    assert.strictEqual(res.status, 403, `Expected HTTP 403, got ${res.status}`);
  });

  await probe("T4.5", "DELETE /api/users unauthenticated returns HTTP 401 Unauthorized", async () => {
    const req = new Request(`http://localhost:3000/api/users?id=${soleAdmin.id}`, {
      method: "DELETE",
      headers: { "x-mock-role": "unauthenticated" },
    });
    const res = await usersDelete(req);
    assert.strictEqual(res.status, 401, `Expected HTTP 401, got ${res.status}`);
  });

  await probe("T4.6", "DELETE /api/users on non-admin developer user succeeds with HTTP 200", async () => {
    const req = new Request(`http://localhost:3000/api/users?id=${refreshedDev.id}`, {
      method: "DELETE",
      headers: { "x-mock-role": "admin" },
    });
    const res = await usersDelete(req);
    assert.strictEqual(res.status, 200, `Expected HTTP 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true);

    const check = db.prepare("SELECT id FROM users WHERE id = ?").get(refreshedDev.id);
    assert.strictEqual(check, undefined, "Developer user must be deleted");
  });

  // ---------------------------------------------------------------------------
  // TARGET 5: Remediated Nginx Routes RBAC Enforcement
  // ---------------------------------------------------------------------------
  console.log("\n--- TARGET 5: Remediated Nginx Routes RBAC Enforcement ---");

  await probe("T5.1", "POST /api/nginx/create: Developer -> 403, Unauthenticated -> 401", async () => {
    const devReq = new Request("http://localhost:3000/api/nginx/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ name: "test", template: "static", domain: "test.com", portOrPath: "/var/www" }),
    });
    const devRes = await nginxCreatePost(devReq);
    assert.strictEqual(devRes.status, 403);

    const unauthReq = new Request("http://localhost:3000/api/nginx/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "unauthenticated" },
      body: JSON.stringify({ name: "test", template: "static", domain: "test.com", portOrPath: "/var/www" }),
    });
    const unauthRes = await nginxCreatePost(unauthReq);
    assert.strictEqual(unauthRes.status, 401);
  });

  await probe("T5.2", "POST /api/nginx/toggle: Developer -> 403, Unauthenticated -> 401", async () => {
    const devReq = new Request("http://localhost:3000/api/nginx/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ name: "default", enable: true }),
    });
    const devRes = await nginxTogglePost(devReq);
    assert.strictEqual(devRes.status, 403);

    const unauthReq = new Request("http://localhost:3000/api/nginx/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "unauthenticated" },
      body: JSON.stringify({ name: "default", enable: true }),
    });
    const unauthRes = await nginxTogglePost(unauthReq);
    assert.strictEqual(unauthRes.status, 401);
  });

  await probe("T5.3", "POST /api/nginx/test: Developer -> 403, Unauthenticated -> 401", async () => {
    const devReq = new Request("http://localhost:3000/api/nginx/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ content: "server {}" }),
    });
    const devRes = await nginxTestPost(devReq);
    assert.strictEqual(devRes.status, 403);

    const unauthReq = new Request("http://localhost:3000/api/nginx/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "unauthenticated" },
      body: JSON.stringify({ content: "server {}" }),
    });
    const unauthRes = await nginxTestPost(unauthReq);
    assert.strictEqual(unauthRes.status, 401);
  });

  await probe("T5.4", "POST /api/nginx/ssl: Developer -> 403, Unauthenticated -> 401", async () => {
    const devReq = new Request("http://localhost:3000/api/nginx/ssl", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ domain: "test.com", email: "admin@test.com" }),
    });
    const devRes = await nginxSslPost(devReq);
    assert.strictEqual(devRes.status, 403);

    const unauthReq = new Request("http://localhost:3000/api/nginx/ssl", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "unauthenticated" },
      body: JSON.stringify({ domain: "test.com", email: "admin@test.com" }),
    });
    const unauthRes = await nginxSslPost(unauthReq);
    assert.strictEqual(unauthRes.status, 401);
  });

  // ---------------------------------------------------------------------------
  // TARGET 6: Production Environment Header Injection Rejection
  // ---------------------------------------------------------------------------
  console.log("\n--- TARGET 6: Production Mode Backdoor Neutralization ---");

  await probe("T6.1", "In NODE_ENV='production', x-mock-role header is completely ignored -> returns 401", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const req = new Request("http://localhost:3000/api/terminal/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
        body: JSON.stringify({ command: "whoami" }),
      });
      const res = await requireAdmin(req);
      assert.ok(res.error, "In production, requireAdmin must reject unauthenticated mock role");
      assert.strictEqual(res.error.status, 401, `Expected HTTP 401, got ${res.error.status}`);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  await probe("T6.2", "In NODE_ENV='production', x-user-role header is completely ignored -> returns 401", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const req = new Request("http://localhost:3000/api/terminal/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-role": "admin" },
        body: JSON.stringify({ command: "whoami" }),
      });
      const res = await requireAdmin(req);
      assert.ok(res.error);
      assert.strictEqual(res.error.status, 401);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  // ---------------------------------------------------------------------------
  // TARGET 7: System Invariant Verification
  // ---------------------------------------------------------------------------
  console.log("\n--- TARGET 7: System Invariants & Setup Takeover Prevention ---");

  await probe("T7.1", "adminExists() returns strictly true after all adversarial attacks", () => {
    const exists = adminExists();
    assert.strictEqual(exists, true, "adminExists() must be true");
  });

  await probe("T7.2", "Total admin count in SQLite is strictly equal to 1", () => {
    const adminCount = (
      db.prepare("SELECT count(*) as count FROM users WHERE LOWER(role) = 'admin'").get() as {
        count: number;
      }
    ).count;
    assert.strictEqual(adminCount, 1, `Expected exactly 1 admin, found ${adminCount}`);
  });

  await probe("T7.3", "Sole admin account record is intact and queryable", () => {
    const admin = db.prepare("SELECT * FROM users WHERE id = ?").get(soleAdmin.id) as any;
    assert.ok(admin, "Admin account record must exist");
    assert.strictEqual(admin.role.toLowerCase(), "admin");
    assert.strictEqual(admin.username, soleAdmin.username);
    assert.ok(admin.passwordHash, "Password hash must be preserved");
  });

  // Summary Report
  console.log("\n================================================================================");
  const passedCount = probeRecords.filter((r) => r.passed).length;
  const totalCount = probeRecords.length;
  console.log(`SUMMARY: ${passedCount}/${totalCount} ADDITIONAL ADVERSARIAL PROBES PASSED`);
  console.log("================================================================================");

  if (passedCount < totalCount) {
    console.error("\nFAILED PROBES:");
    for (const r of probeRecords.filter((r) => !r.passed)) {
      console.error(` - Probe ${r.id} (${r.name}): ${r.details}`);
    }
    process.exit(1);
  } else {
    console.log("\nALL ADDITIONAL ADVERSARIAL PROBES PASSED WITH 100% SUCCESS.");
  }
}

runAdditionalAdversarialProbes().catch((err) => {
  console.error("FATAL ERROR running additional adversarial probes:", err);
  process.exit(1);
});
