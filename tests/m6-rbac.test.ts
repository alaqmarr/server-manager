/**
 * Milestone 6: RBAC Team Roles & Route Protection Test Suite
 * Tests:
 * 1. Database schema, trigger behavior, and user helper functions
 * 2. Auth Guard requireAuth and requireAdmin logic (401 / 403 responses)
 * 3. Route handlers with mock Developer vs Admin vs Unauthenticated requests:
 *    - /api/terminal/execute
 *    - /api/nginx/files
 *    - /api/nginx/content
 *    - /api/nginx/save
 *    - /api/env (GET & POST)
 *    - /api/users (GET & POST)
 * 4. Auth config public whitelist for /api/deploy/webhook
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import bcrypt from "bcrypt";
import {
  db,
  createUser,
  getUserByUsername,
  getAdminByUsername,
  listUsers,
  updateUserRole,
  deleteUser,
  adminExists,
} from "../src/lib/db";
import { requireAuth, requireAdmin } from "../src/lib/auth-guard";
import { authConfig } from "../src/auth.config";

// Route handlers
import { POST as terminalExecutePost } from "../src/app/api/terminal/execute/route";
import { GET as nginxFilesGet } from "../src/app/api/nginx/files/route";
import { GET as nginxContentGet } from "../src/app/api/nginx/content/route";
import { POST as nginxSavePost } from "../src/app/api/nginx/save/route";
import { POST as nginxCreatePost } from "../src/app/api/nginx/create/route";
import { POST as nginxTogglePost } from "../src/app/api/nginx/toggle/route";
import { POST as nginxTestPost } from "../src/app/api/nginx/test/route";
import { POST as nginxSslPost } from "../src/app/api/nginx/ssl/route";
import { GET as envGet, POST as envPost } from "../src/app/api/env/route";
import {
  GET as usersGet,
  POST as usersPost,
  PATCH as usersPatch,
  DELETE as usersDelete,
} from "../src/app/api/users/route";

async function runTests() {
  console.log("=== Running Milestone 6 RBAC Test Suite ===\n");
  let passed = 0;
  let total = 0;

  async function it(name: string, fn: () => void | Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ ${name}:`, err.message);
      throw err;
    }
  }

  // --- SECTION 1: Database Schema, Trigger & Helpers ---
  console.log("Section 1: Database Schema, Trigger & Helpers");

  await it("1.1: adminExists() returns true when admin user exists", () => {
    assert.strictEqual(adminExists(), true);
  });

  await it("1.2: createUser() allows creating developer accounts", async () => {
    const hash = await bcrypt.hash("testdevpass", 10);
    const created = createUser("m6_test_dev1", hash, "developer");
    assert.strictEqual(created, true);

    const user = getUserByUsername("m6_test_dev1");
    assert.ok(user);
    assert.strictEqual(user.username, "m6_test_dev1");
    assert.strictEqual(user.role, "developer");
  });

  await it("1.3: createUser() allows creating multiple developer accounts", async () => {
    const hash = await bcrypt.hash("testdevpass2", 10);
    const created = createUser("m6_test_dev2", hash, "developer");
    assert.strictEqual(created, true);

    const user = getUserByUsername("m6_test_dev2");
    assert.ok(user);
    assert.strictEqual(user.username, "m6_test_dev2");
    assert.strictEqual(user.role, "developer");
  });

  await it("1.4: SQLite trigger blocks creating a second admin account", async () => {
    const hash = await bcrypt.hash("admin2pass", 10);
    const created = createUser("second_admin", hash, "admin");
    assert.strictEqual(created, false, "Creating second admin should fail due to trigger");
  });

  await it("1.5: listUsers() returns all users without exposing passwordHash", () => {
    const users = listUsers();
    assert.ok(Array.isArray(users));
    assert.ok(users.length >= 3);
    for (const u of users) {
      assert.ok(u.id);
      assert.ok(u.username);
      assert.ok(u.role);
      assert.strictEqual((u as any).passwordHash, undefined, "passwordHash must not be exposed");
    }
  });

  await it("1.6: updateUserRole() updates role between valid roles", () => {
    const dev = getUserByUsername("m6_test_dev2");
    assert.ok(dev);
    const updated = updateUserRole(dev.id, "developer");
    assert.strictEqual(updated, true);
  });

  await it("1.7: deleteUser() removes non-admin user", () => {
    const dev = getUserByUsername("m6_test_dev2");
    assert.ok(dev);
    const deleted = deleteUser(dev.id);
    assert.strictEqual(deleted, true);
    assert.strictEqual(getUserByUsername("m6_test_dev2"), null);
  });

  await it("1.8: deleteUser() prevents deleting the last remaining administrator", () => {
    const admin = db.prepare("SELECT id FROM users WHERE LOWER(role) = 'admin'").get() as { id: number };
    assert.ok(admin);
    const deleted = deleteUser(admin.id);
    assert.strictEqual(deleted, false, "Should not delete last admin");
  });

  await it("1.9: updateUserRole() prevents demoting the last remaining administrator", () => {
    const admin = db.prepare("SELECT id FROM users WHERE LOWER(role) = 'admin'").get() as { id: number };
    assert.ok(admin);
    const updated = updateUserRole(admin.id, "developer");
    assert.strictEqual(updated, false, "Should not demote last admin");
  });

  await it("1.10: SQLite trigger prevent_last_admin_demote aborts direct SQL UPDATE", () => {
    const admin = db.prepare("SELECT id FROM users WHERE LOWER(role) = 'admin'").get() as { id: number };
    assert.ok(admin);
    let thrownError: any = null;
    try {
      db.prepare("UPDATE users SET role = 'developer' WHERE id = ?").run(admin.id);
    } catch (err: any) {
      thrownError = err;
    }
    assert.ok(thrownError, "Expected trigger abort error");
    assert.ok(thrownError.message.includes("Cannot demote the last remaining administrator"));
  });

  await it("1.11: SQLite trigger prevent_last_admin_delete aborts direct SQL DELETE", () => {
    const admin = db.prepare("SELECT id FROM users WHERE LOWER(role) = 'admin'").get() as { id: number };
    assert.ok(admin);
    let thrownError: any = null;
    try {
      db.prepare("DELETE FROM users WHERE id = ?").run(admin.id);
    } catch (err: any) {
      thrownError = err;
    }
    assert.ok(thrownError, "Expected trigger abort error");
    assert.ok(thrownError.message.includes("Cannot delete the last remaining administrator"));
  });

  await it("1.12: PATCH /api/users rejects demoting the last remaining administrator", async () => {
    const admin = db.prepare("SELECT id FROM users WHERE LOWER(role) = 'admin'").get() as { id: number };
    assert.ok(admin);
    const req = new Request("http://localhost:3000/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
      body: JSON.stringify({ id: admin.id, role: "developer" }),
    });
    const res = await usersPatch(req);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("Cannot demote the last remaining administrator"));
  });

  await it("1.13: DELETE /api/users rejects deleting the last remaining administrator", async () => {
    const admin = db.prepare("SELECT id FROM users WHERE LOWER(role) = 'admin'").get() as { id: number };
    assert.ok(admin);
    const req = new Request(`http://localhost:3000/api/users?id=${admin.id}`, {
      method: "DELETE",
      headers: { "x-mock-role": "admin" },
    });
    const res = await usersDelete(req);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("Cannot delete the last remaining administrator"));
  });

  // --- SECTION 2: Auth Guard Helpers ---
  console.log("\nSection 2: Auth Guard Helpers");

  await it("2.1: requireAuth() with mock unauthenticated returns 401", async () => {
    const req = new Request("http://localhost:3000/api/test", {
      headers: { "x-mock-role": "unauthenticated" },
    });
    const result = await requireAuth(req);
    assert.ok(result.error);
    assert.strictEqual(result.error.status, 401);
  });

  await it("2.2: requireAuth() with mock developer role returns session", async () => {
    const req = new Request("http://localhost:3000/api/test", {
      headers: { "x-mock-role": "developer" },
    });
    const result = await requireAuth(req);
    assert.strictEqual(result.error, null);
    assert.ok(result.session);
    assert.strictEqual((result.session.user as any).role, "developer");
  });

  await it("2.3: requireAdmin() with mock developer role returns 403 Forbidden", async () => {
    const req = new Request("http://localhost:3000/api/test", {
      headers: { "x-mock-role": "developer" },
    });
    const result = await requireAdmin(req);
    assert.ok(result.error);
    assert.strictEqual(result.error.status, 403);
    const body = await result.error.json();
    assert.ok(body.error.includes("Forbidden") || body.error.includes("Admin"));
  });

  await it("2.4: requireAdmin() with mock admin role returns session", async () => {
    const req = new Request("http://localhost:3000/api/test", {
      headers: { "x-mock-role": "admin" },
    });
    const result = await requireAdmin(req);
    assert.strictEqual(result.error, null);
    assert.ok(result.session);
    assert.strictEqual((result.session.user as any).role, "admin");
  });

  await it("2.5: requireAuth() with bare request without headers returns 401 (no 500 throw)", async () => {
    const req = new Request("http://localhost:3000/api/test");
    const result = await requireAuth(req);
    assert.ok(result.error);
    assert.strictEqual(result.error.status, 401);
  });

  await it("2.6: requireAdmin() strictly rejects x-mock-role in production (NODE_ENV=production)", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const req = new Request("http://localhost:3000/api/test", {
        headers: { "x-mock-role": "admin" },
      });
      const result = await requireAdmin(req);
      assert.ok(result.error);
      assert.strictEqual(result.error.status, 401);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  // --- SECTION 3: Sensitive Route Protection ---
  console.log("\nSection 3: Sensitive Route Protection");

  // 3.1 Terminal Execute
  await it("3.1: POST /api/terminal/execute returns 403 for Developer role", async () => {
    const req = new Request("http://localhost:3000/api/terminal/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ command: "whoami" }),
    });
    const res = await terminalExecutePost(req);
    assert.strictEqual(res.status, 403);
  });

  await it("3.2: POST /api/terminal/execute returns 401 for Unauthenticated", async () => {
    const req = new Request("http://localhost:3000/api/terminal/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "unauthenticated" },
      body: JSON.stringify({ command: "whoami" }),
    });
    const res = await terminalExecutePost(req);
    assert.strictEqual(res.status, 401);
  });

  await it("3.3: POST /api/terminal/execute succeeds (200) for Admin role", async () => {
    const req = new Request("http://localhost:3000/api/terminal/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
      body: JSON.stringify({ command: "echo test-admin" }),
    });
    const res = await terminalExecutePost(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.stdout.includes("test-admin"));
  });

  // 3.2 Nginx Routes
  await it("3.4: GET /api/nginx/files returns 403 for Developer role", async () => {
    const req = new Request("http://localhost:3000/api/nginx/files", {
      headers: { "x-mock-role": "developer" },
    });
    const res = await nginxFilesGet(req);
    assert.strictEqual(res.status, 403);
  });

  await it("3.5: GET /api/nginx/files returns 401 for Unauthenticated", async () => {
    const req = new Request("http://localhost:3000/api/nginx/files", {
      headers: { "x-mock-role": "unauthenticated" },
    });
    const res = await nginxFilesGet(req);
    assert.strictEqual(res.status, 401);
  });

  await it("3.6: GET /api/nginx/files succeeds (200) for Admin role", async () => {
    const req = new Request("http://localhost:3000/api/nginx/files", {
      headers: { "x-mock-role": "admin" },
    });
    const res = await nginxFilesGet(req);
    assert.strictEqual(res.status, 200);
  });

  await it("3.7: GET /api/nginx/content returns 403 for Developer role", async () => {
    const req = new Request("http://localhost:3000/api/nginx/content?file=nginx.conf", {
      headers: { "x-mock-role": "developer" },
    });
    const res = await nginxContentGet(req);
    assert.strictEqual(res.status, 403);
  });

  await it("3.8: POST /api/nginx/save returns 403 for Developer role", async () => {
    const req = new Request("http://localhost:3000/api/nginx/save", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ relativePath: "nginx.conf", content: "# test" }),
    });
    const res = await nginxSavePost(req);
    assert.strictEqual(res.status, 403);
  });

  // 3.3 Environment Variables Route
  await it("3.9: GET /api/env returns 403 for Developer role", async () => {
    const req = new Request("http://localhost:3000/api/env", {
      headers: { "x-mock-role": "developer" },
    });
    const res = await envGet(req);
    assert.strictEqual(res.status, 403);
  });

  await it("3.10: GET /api/env succeeds (200) for Admin role with masked secrets", async () => {
    process.env.TEST_API_KEY = "my_super_secret_api_key_12345";
    const req = new Request("http://localhost:3000/api/env", {
      headers: { "x-mock-role": "admin" },
    });
    const res = await envGet(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.envVars));

    const testKeyVar = data.envVars.find((v: any) => v.key === "TEST_API_KEY");
    assert.ok(testKeyVar, "TEST_API_KEY must be in envVars");
    assert.strictEqual(testKeyVar.masked, true);
    assert.ok(!testKeyVar.value.includes("super_secret"), "Secret must be masked");
  });

  await it("3.11: POST /api/env returns 403 for Developer role", async () => {
    const req = new Request("http://localhost:3000/api/env", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ action: "read", dirPath: "." }),
    });
    const res = await envPost(req);
    assert.strictEqual(res.status, 403);
  });

  // 3.4 Users Management Route
  await it("3.12: GET /api/users returns 403 for Developer role", async () => {
    const req = new Request("http://localhost:3000/api/users", {
      headers: { "x-mock-role": "developer" },
    });
    const res = await usersGet(req);
    assert.strictEqual(res.status, 403);
  });

  await it("3.13: GET /api/users succeeds (200) for Admin role", async () => {
    const req = new Request("http://localhost:3000/api/users", {
      headers: { "x-mock-role": "admin" },
    });
    const res = await usersGet(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.users));
  });

  await it("3.14: POST /api/users returns 403 for Developer role", async () => {
    const req = new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ username: "unauthorized_dev", password: "password123", role: "developer" }),
    });
    const res = await usersPost(req);
    assert.strictEqual(res.status, 403);
  });

  await it("3.15: POST /api/users allows Admin to create a developer user", async () => {
    const req = new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
      body: JSON.stringify({ username: "api_created_dev", password: "password123", role: "developer" }),
    });
    const res = await usersPost(req);
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.user.role, "developer");
  });

  await it("3.16: POST /api/users blocks Admin from creating a second admin", async () => {
    const req = new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
      body: JSON.stringify({ username: "another_admin", password: "password123", role: "admin" }),
    });
    const res = await usersPost(req);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("Only one administrator"));
  });

  // 3.5 Newly Protected Nginx Routes & Bare 401 Handling
  await it("3.17: POST /api/nginx/create returns 403 for Developer and 401 for Unauthenticated", async () => {
    const devReq = new Request("http://localhost:3000/api/nginx/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ name: "test", template: "spa", domain: "example.com", portOrPath: "3000" }),
    });
    const devRes = await nginxCreatePost(devReq);
    assert.strictEqual(devRes.status, 403);

    const unauthReq = new Request("http://localhost:3000/api/nginx/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "unauthenticated" },
      body: JSON.stringify({ name: "test", template: "spa", domain: "example.com", portOrPath: "3000" }),
    });
    const unauthRes = await nginxCreatePost(unauthReq);
    assert.strictEqual(unauthRes.status, 401);
  });

  await it("3.18: POST /api/nginx/toggle returns 403 for Developer and 401 for Unauthenticated", async () => {
    const devReq = new Request("http://localhost:3000/api/nginx/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ name: "test", enable: true }),
    });
    const devRes = await nginxTogglePost(devReq);
    assert.strictEqual(devRes.status, 403);

    const unauthReq = new Request("http://localhost:3000/api/nginx/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "unauthenticated" },
      body: JSON.stringify({ name: "test", enable: true }),
    });
    const unauthRes = await nginxTogglePost(unauthReq);
    assert.strictEqual(unauthRes.status, 401);
  });

  await it("3.19: POST /api/nginx/test returns 403 for Developer and 401 for Unauthenticated", async () => {
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

  await it("3.20: POST /api/nginx/ssl returns 403 for Developer and 401 for Unauthenticated", async () => {
    const devReq = new Request("http://localhost:3000/api/nginx/ssl", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
      body: JSON.stringify({ domain: "example.com", email: "admin@example.com" }),
    });
    const devRes = await nginxSslPost(devReq);
    assert.strictEqual(devRes.status, 403);

    const unauthReq = new Request("http://localhost:3000/api/nginx/ssl", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-role": "unauthenticated" },
      body: JSON.stringify({ domain: "example.com", email: "admin@example.com" }),
    });
    const unauthRes = await nginxSslPost(unauthReq);
    assert.strictEqual(unauthRes.status, 401);
  });

  await it("3.21: Bare unauthenticated requests to all sensitive endpoints return 401 (not 500)", async () => {
    const endpoints = [
      () => terminalExecutePost(new Request("http://localhost:3000/api/terminal/execute", { method: "POST" })),
      () => nginxFilesGet(new Request("http://localhost:3000/api/nginx/files")),
      () => nginxContentGet(new Request("http://localhost:3000/api/nginx/content?file=nginx.conf")),
      () => nginxSavePost(new Request("http://localhost:3000/api/nginx/save", { method: "POST" })),
      () => nginxCreatePost(new Request("http://localhost:3000/api/nginx/create", { method: "POST" })),
      () => nginxTogglePost(new Request("http://localhost:3000/api/nginx/toggle", { method: "POST" })),
      () => nginxTestPost(new Request("http://localhost:3000/api/nginx/test", { method: "POST" })),
      () => nginxSslPost(new Request("http://localhost:3000/api/nginx/ssl", { method: "POST" })),
      () => envGet(new Request("http://localhost:3000/api/env")),
      () => envPost(new Request("http://localhost:3000/api/env", { method: "POST" })),
      () => usersGet(new Request("http://localhost:3000/api/users")),
      () => usersPost(new Request("http://localhost:3000/api/users", { method: "POST" })),
      () => usersPatch(new Request("http://localhost:3000/api/users", { method: "PATCH" })),
      () => usersDelete(new Request("http://localhost:3000/api/users?id=1", { method: "DELETE" })),
    ];

    for (const ep of endpoints) {
      const res = await ep();
      assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
    }
  });

  // --- SECTION 4: Public Route Whitelist in auth.config.ts ---
  console.log("\nSection 4: Public Route Whitelist");

  await it("4.1: auth.config.ts whitelists /api/deploy/webhook for unauthenticated access", () => {
    const authorized = authConfig.callbacks?.authorized;
    assert.ok(authorized);
    const mockRequest = {
      nextUrl: new URL("http://localhost:3000/api/deploy/webhook"),
    };
    const isAllowed = (authorized as any)({ auth: null, request: mockRequest });
    assert.strictEqual(isAllowed, true, "/api/deploy/webhook must be allowed without auth session");
  });

  // Cleanup test users
  const testUsers = ["m6_test_dev1", "api_created_dev"];
  for (const u of testUsers) {
    const user = getUserByUsername(u);
    if (user) deleteUser(user.id);
  }

  console.log(`\n=== All ${passed}/${total} Milestone 6 RBAC Tests Passed Successfully! ===`);
}

runTests().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
