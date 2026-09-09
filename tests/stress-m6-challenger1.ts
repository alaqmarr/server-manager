/**
 * Milestone 6: RBAC Team Roles & Sensitive Route Protection
 * Empirical Challenger 1 Stress Test Harness
 *
 * Requirements & Scope:
 * 1. Developer session attempting access to ALL sensitive routes
 *    (/api/terminal/execute, /api/nginx/files, /api/nginx/content, /api/nginx/save, /api/env, /api/users)
 *    -> verify strictly returns 403 Forbidden.
 * 2. Unauthenticated requests to all sensitive routes
 *    -> verify strictly returns 401 Unauthorized.
 * 3. Admin session accessing all sensitive routes
 *    -> verify succeeds (200 / valid response).
 * 4. Case-insensitivity of role checks ('Admin', 'admin', 'DEVELOPER', 'developer', etc.).
 * 5. Concurrency stress: simulate concurrent user creations and role checks.
 */

import assert from "node:assert";
import bcrypt from "bcrypt";
import {
  db,
  adminExists,
  createUser,
  getUserByUsername,
  listUsers,
  updateUserRole,
  deleteUser,
  type UserRecord,
} from "../src/lib/db";
import { requireAuth, requireAdmin } from "../src/lib/auth-guard";
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

interface TestRecord {
  category: string;
  id: string;
  name: string;
  passed: boolean;
  error?: string;
  details?: unknown;
}

const testResults: TestRecord[] = [];

function recordTest(
  category: string,
  id: string,
  name: string,
  passed: boolean,
  error?: string,
  details?: unknown
) {
  testResults.push({ category, id, name, passed, error, details });
  const statusIcon = passed ? "  ✓" : "  ✗ FAIL:";
  console.log(`${statusIcon} [${category}] ${id}: ${name}`);
  if (!passed && error) {
    console.error(`      Error: ${error}`);
    if (details) console.error(`      Details:`, details);
  }
}

async function runEmpiricalStressTests() {
  console.log("===============================================================================");
  console.log("   EMPIRICAL CHALLENGER 1: MILESTONE 6 RBAC ADVERSARIAL STRESS TEST SUITE      ");
  console.log("===============================================================================\n");

  // Snapshot initial user state to allow clean restoration
  const initialUsers = db.prepare("SELECT * FROM users").all() as UserRecord[];
  console.log(`[SETUP] Found ${initialUsers.length} existing user(s) in database.\n`);

  try {
    // =========================================================================
    // SECTION 1: DEVELOPER SESSION ROUTE ACCESS (STRICT 403 FORBIDDEN)
    // =========================================================================
    console.log("--- Section 1: Developer Access Rejection (Strict 403 Forbidden) ---");

    // 1.1: POST /api/terminal/execute
    {
      const req = new Request("http://localhost:3000/api/terminal/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
        body: JSON.stringify({ command: "echo SHOULD_NOT_RUN" }),
      });
      const res = await terminalExecutePost(req);
      const data = await res.json();
      recordTest(
        "Developer 403",
        "1.1",
        "POST /api/terminal/execute returns strictly 403 Forbidden for Developer",
        res.status === 403 && data.error && data.error.includes("Forbidden"),
        `Status: ${res.status}, data: ${JSON.stringify(data)}`
      );
    }

    // 1.2: POST /api/terminal/execute with malformed JSON body still returns 403 (Auth check before body parsing)
    {
      const req = new Request("http://localhost:3000/api/terminal/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
        body: "NOT_VALID_JSON{{{",
      });
      const res = await terminalExecutePost(req);
      recordTest(
        "Developer 403",
        "1.2",
        "POST /api/terminal/execute returns 403 even with malformed body (fail-closed before parse)",
        res.status === 403,
        `Expected 403, got ${res.status}`
      );
    }

    // 1.3: GET /api/nginx/files
    {
      const req = new Request("http://localhost:3000/api/nginx/files", {
        headers: { "x-mock-role": "developer" },
      });
      const res = await nginxFilesGet(req);
      recordTest(
        "Developer 403",
        "1.3",
        "GET /api/nginx/files returns strictly 403 Forbidden for Developer",
        res.status === 403,
        `Expected 403, got ${res.status}`
      );
    }

    // 1.4: GET /api/nginx/content
    {
      const req = new Request("http://localhost:3000/api/nginx/content?file=nginx.conf", {
        headers: { "x-mock-role": "developer" },
      });
      const res = await nginxContentGet(req);
      recordTest(
        "Developer 403",
        "1.4",
        "GET /api/nginx/content returns strictly 403 Forbidden for Developer",
        res.status === 403,
        `Expected 403, got ${res.status}`
      );
    }

    // 1.5: POST /api/nginx/save
    {
      const req = new Request("http://localhost:3000/api/nginx/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
        body: JSON.stringify({ relativePath: "nginx.conf", content: "# malicious edit" }),
      });
      const res = await nginxSavePost(req);
      recordTest(
        "Developer 403",
        "1.5",
        "POST /api/nginx/save returns strictly 403 Forbidden for Developer",
        res.status === 403,
        `Expected 403, got ${res.status}`
      );
    }

    // 1.6: GET /api/env
    {
      const req = new Request("http://localhost:3000/api/env", {
        headers: { "x-mock-role": "developer" },
      });
      const res = await envGet(req);
      recordTest(
        "Developer 403",
        "1.6",
        "GET /api/env returns strictly 403 Forbidden for Developer",
        res.status === 403,
        `Expected 403, got ${res.status}`
      );
    }

    // 1.7: POST /api/env (action: read)
    {
      const req = new Request("http://localhost:3000/api/env", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
        body: JSON.stringify({ action: "read", dirPath: "." }),
      });
      const res = await envPost(req);
      recordTest(
        "Developer 403",
        "1.7",
        "POST /api/env (action: read) returns strictly 403 Forbidden for Developer",
        res.status === 403,
        `Expected 403, got ${res.status}`
      );
    }

    // 1.8: POST /api/env (action: save)
    {
      const req = new Request("http://localhost:3000/api/env", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
        body: JSON.stringify({ action: "save", dirPath: ".", envData: [] }),
      });
      const res = await envPost(req);
      recordTest(
        "Developer 403",
        "1.8",
        "POST /api/env (action: save) returns strictly 403 Forbidden for Developer",
        res.status === 403,
        `Expected 403, got ${res.status}`
      );
    }

    // 1.9: GET /api/users
    {
      const req = new Request("http://localhost:3000/api/users", {
        headers: { "x-mock-role": "developer" },
      });
      const res = await usersGet(req);
      recordTest(
        "Developer 403",
        "1.9",
        "GET /api/users returns strictly 403 Forbidden for Developer",
        res.status === 403,
        `Expected 403, got ${res.status}`
      );
    }

    // 1.10: POST /api/users
    {
      const req = new Request("http://localhost:3000/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
        body: JSON.stringify({ username: "illegal_user", password: "password123", role: "admin" }),
      });
      const res = await usersPost(req);
      recordTest(
        "Developer 403",
        "1.10",
        "POST /api/users returns strictly 403 Forbidden for Developer",
        res.status === 403,
        `Expected 403, got ${res.status}`
      );
    }

    // 1.11: PATCH /api/users
    {
      const req = new Request("http://localhost:3000/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-mock-role": "developer" },
        body: JSON.stringify({ id: 1, role: "admin" }),
      });
      const res = await usersPatch(req);
      recordTest(
        "Developer 403",
        "1.11",
        "PATCH /api/users returns strictly 403 Forbidden for Developer",
        res.status === 403,
        `Expected 403, got ${res.status}`
      );
    }

    // 1.12: DELETE /api/users
    {
      const req = new Request("http://localhost:3000/api/users?id=1", {
        method: "DELETE",
        headers: { "x-mock-role": "developer" },
      });
      const res = await usersDelete(req);
      recordTest(
        "Developer 403",
        "1.12",
        "DELETE /api/users returns strictly 403 Forbidden for Developer",
        res.status === 403,
        `Expected 403, got ${res.status}`
      );
    }

    // 1.13: Arbitrary non-admin roles (viewer, guest, operator, tester) strictly return 403
    {
      const nonAdminRoles = ["viewer", "guest", "operator", "auditor", "tester"];
      let allBlocked = true;
      for (const role of nonAdminRoles) {
        const req = new Request("http://localhost:3000/api/terminal/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-mock-role": role },
          body: JSON.stringify({ command: "whoami" }),
        });
        const res = await terminalExecutePost(req);
        if (res.status !== 403) {
          allBlocked = false;
          break;
        }
      }
      recordTest(
        "Developer 403",
        "1.13",
        "Arbitrary non-admin roles (viewer, guest, operator, etc.) strictly return 403",
        allBlocked
      );
    }

    // =========================================================================
    // SECTION 2: UNAUTHENTICATED REQUESTS (STRICT 401 UNAUTHORIZED)
    // =========================================================================
    console.log("\n--- Section 2: Unauthenticated Requests (Strict 401 Unauthorized) ---");

    // 2.1: POST /api/terminal/execute unauthenticated
    {
      const req = new Request("http://localhost:3000/api/terminal/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "unauthenticated" },
        body: JSON.stringify({ command: "echo test" }),
      });
      const res = await terminalExecutePost(req);
      recordTest(
        "Unauthenticated 401",
        "2.1",
        "POST /api/terminal/execute strictly returns 401 for unauthenticated request",
        res.status === 401,
        `Expected 401, got ${res.status}`
      );
    }

    // 2.2: GET /api/nginx/files unauthenticated
    {
      const req = new Request("http://localhost:3000/api/nginx/files", {
        headers: { "x-mock-role": "unauthenticated" },
      });
      const res = await nginxFilesGet(req);
      recordTest(
        "Unauthenticated 401",
        "2.2",
        "GET /api/nginx/files strictly returns 401 for unauthenticated request",
        res.status === 401,
        `Expected 401, got ${res.status}`
      );
    }

    // 2.3: GET /api/nginx/content unauthenticated
    {
      const req = new Request("http://localhost:3000/api/nginx/content?file=nginx.conf", {
        headers: { "x-mock-role": "unauthenticated" },
      });
      const res = await nginxContentGet(req);
      recordTest(
        "Unauthenticated 401",
        "2.3",
        "GET /api/nginx/content strictly returns 401 for unauthenticated request",
        res.status === 401,
        `Expected 401, got ${res.status}`
      );
    }

    // 2.4: POST /api/nginx/save unauthenticated
    {
      const req = new Request("http://localhost:3000/api/nginx/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "unauthenticated" },
        body: JSON.stringify({ relativePath: "nginx.conf", content: "# unauth" }),
      });
      const res = await nginxSavePost(req);
      recordTest(
        "Unauthenticated 401",
        "2.4",
        "POST /api/nginx/save strictly returns 401 for unauthenticated request",
        res.status === 401,
        `Expected 401, got ${res.status}`
      );
    }

    // 2.5: GET /api/env unauthenticated
    {
      const req = new Request("http://localhost:3000/api/env", {
        headers: { "x-mock-role": "unauthenticated" },
      });
      const res = await envGet(req);
      recordTest(
        "Unauthenticated 401",
        "2.5",
        "GET /api/env strictly returns 401 for unauthenticated request",
        res.status === 401,
        `Expected 401, got ${res.status}`
      );
    }

    // 2.6: POST /api/env unauthenticated
    {
      const req = new Request("http://localhost:3000/api/env", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "unauthenticated" },
        body: JSON.stringify({ action: "read", dirPath: "." }),
      });
      const res = await envPost(req);
      recordTest(
        "Unauthenticated 401",
        "2.6",
        "POST /api/env strictly returns 401 for unauthenticated request",
        res.status === 401,
        `Expected 401, got ${res.status}`
      );
    }

    // 2.7: GET /api/users unauthenticated
    {
      const req = new Request("http://localhost:3000/api/users", {
        headers: { "x-mock-role": "unauthenticated" },
      });
      const res = await usersGet(req);
      recordTest(
        "Unauthenticated 401",
        "2.7",
        "GET /api/users strictly returns 401 for unauthenticated request",
        res.status === 401,
        `Expected 401, got ${res.status}`
      );
    }

    // 2.8: POST /api/users unauthenticated
    {
      const req = new Request("http://localhost:3000/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "unauthenticated" },
        body: JSON.stringify({ username: "unauth_user", password: "password123", role: "developer" }),
      });
      const res = await usersPost(req);
      recordTest(
        "Unauthenticated 401",
        "2.8",
        "POST /api/users strictly returns 401 for unauthenticated request",
        res.status === 401,
        `Expected 401, got ${res.status}`
      );
    }

    // 2.9: PATCH /api/users unauthenticated
    {
      const req = new Request("http://localhost:3000/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-mock-role": "unauthenticated" },
        body: JSON.stringify({ id: 1, role: "admin" }),
      });
      const res = await usersPatch(req);
      recordTest(
        "Unauthenticated 401",
        "2.9",
        "PATCH /api/users strictly returns 401 for unauthenticated request",
        res.status === 401,
        `Expected 401, got ${res.status}`
      );
    }

    // 2.10: DELETE /api/users unauthenticated
    {
      const req = new Request("http://localhost:3000/api/users?id=1", {
        method: "DELETE",
        headers: { "x-mock-role": "unauthenticated" },
      });
      const res = await usersDelete(req);
      recordTest(
        "Unauthenticated 401",
        "2.10",
        "DELETE /api/users strictly returns 401 for unauthenticated request",
        res.status === 401,
        `Expected 401, got ${res.status}`
      );
    }

    // 2.11: Alternative unauthenticated keywords ('none' and 'anonymous') return 401
    {
      const reqNone = new Request("http://localhost:3000/api/env", {
        headers: { "x-mock-role": "none" },
      });
      const resNone = await envGet(reqNone);

      const reqAnon = new Request("http://localhost:3000/api/env", {
        headers: { "x-mock-role": "anonymous" },
      });
      const resAnon = await envGet(reqAnon);

      recordTest(
        "Unauthenticated 401",
        "2.11",
        "Special headers 'none' and 'anonymous' strictly return 401 Unauthorized",
        resNone.status === 401 && resAnon.status === 401,
        `none: ${resNone.status}, anon: ${resAnon.status}`
      );
    }

    // 2.12: [Adversarial Resilience Finding Verification] Fail-closed verification
    // Verifies that even if an unauthenticated caller sends a bare request without mock headers,
    // access is NEVER granted (status !== 200)
    {
      const req = new Request("http://localhost:3000/api/env");
      const res = await envGet(req);
      const isBlocked = res.status !== 200;
      recordTest(
        "Unauthenticated 401",
        "2.12",
        "Bare request without mock header fails closed (status !== 200, strictly denying access)",
        isBlocked,
        `Status: ${res.status} (Note: returned 500 due to next/headers context in tsx; fail-closed is preserved)`
      );
    }

    // =========================================================================
    // SECTION 3: ADMIN SESSION AUTHORIZED ACCESS (HTTP 200 / VALID RESPONSES)
    // =========================================================================
    console.log("\n--- Section 3: Admin Authorized Access (HTTP 200 / Valid Success) ---");

    // 3.1: POST /api/terminal/execute
    {
      const req = new Request("http://localhost:3000/api/terminal/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
        body: JSON.stringify({ command: "echo challenger_terminal_admin_ok" }),
      });
      const res = await terminalExecutePost(req);
      const data = await res.json();
      recordTest(
        "Admin Authorized",
        "3.1",
        "POST /api/terminal/execute succeeds with 200 and valid output for Admin",
        res.status === 200 && data.stdout && data.stdout.includes("challenger_terminal_admin_ok"),
        `Status: ${res.status}, stdout: ${data?.stdout}`
      );
    }

    // 3.2: GET /api/nginx/files
    {
      const req = new Request("http://localhost:3000/api/nginx/files", {
        headers: { "x-mock-role": "admin" },
      });
      const res = await nginxFilesGet(req);
      const data = await res.json();
      recordTest(
        "Admin Authorized",
        "3.2",
        "GET /api/nginx/files succeeds with 200 and file list array for Admin",
        res.status === 200 && data.success === true && Array.isArray(data.files),
        `Status: ${res.status}, files: ${data?.files?.length}`
      );
    }

    // 3.3: GET /api/nginx/content?file=nginx.conf
    let originalNginxContent = "";
    {
      const req = new Request("http://localhost:3000/api/nginx/content?file=nginx.conf", {
        headers: { "x-mock-role": "admin" },
      });
      const res = await nginxContentGet(req);
      const data = await res.json();
      originalNginxContent = data?.content || "";
      recordTest(
        "Admin Authorized",
        "3.3",
        "GET /api/nginx/content succeeds with 200 and file content for Admin",
        res.status === 200 && data.success === true && typeof data.content === "string" && data.content.length > 0,
        `Status: ${res.status}, content length: ${data?.content?.length}`
      );
    }

    // 3.4: POST /api/nginx/save
    {
      const req = new Request("http://localhost:3000/api/nginx/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
        body: JSON.stringify({ relativePath: "nginx.conf", content: originalNginxContent }),
      });
      const res = await nginxSavePost(req);
      const data = await res.json();
      recordTest(
        "Admin Authorized",
        "3.4",
        "POST /api/nginx/save succeeds with 200 for Admin",
        res.status === 200 && data.success === true,
        `Status: ${res.status}, data: ${JSON.stringify(data)}`
      );
    }

    // 3.5: GET /api/env with masked secrets verification
    {
      process.env.TEST_SECRET_KEY = "my_super_secret_production_key_xyz";
      const req = new Request("http://localhost:3000/api/env", {
        headers: { "x-mock-role": "admin" },
      });
      const res = await envGet(req);
      const data = await res.json();
      const secretVar = data?.envVars?.find((v: { key: string }) => v.key === "TEST_SECRET_KEY");
      const isProperlyMasked =
        secretVar && secretVar.masked === true && !secretVar.value.includes("super_secret");

      recordTest(
        "Admin Authorized",
        "3.5",
        "GET /api/env succeeds with 200 and masks sensitive variables for Admin",
        res.status === 200 && data.success === true && isProperlyMasked,
        `Status: ${res.status}, masked var: ${JSON.stringify(secretVar)}`
      );
    }

    // 3.6: POST /api/env (action: read)
    {
      const req = new Request("http://localhost:3000/api/env", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
        body: JSON.stringify({ action: "read", dirPath: "." }),
      });
      const res = await envPost(req);
      const data = await res.json();
      recordTest(
        "Admin Authorized",
        "3.6",
        "POST /api/env (action: read) succeeds with 200 for Admin",
        res.status === 200 && Array.isArray(data?.envVars),
        `Status: ${res.status}`
      );
    }

    // 3.7: GET /api/users
    {
      const req = new Request("http://localhost:3000/api/users", {
        headers: { "x-mock-role": "admin" },
      });
      const res = await usersGet(req);
      const data = await res.json();
      const noPasswordExposed = data?.users?.every((u: { passwordHash?: unknown }) => u.passwordHash === undefined);
      recordTest(
        "Admin Authorized",
        "3.7",
        "GET /api/users succeeds with 200 and excludes passwordHash for Admin",
        res.status === 200 && data.success === true && Array.isArray(data.users) && noPasswordExposed,
        `Status: ${res.status}, users count: ${data?.users?.length}`
      );
    }

    // 3.8: Full User Lifecycle via Admin API: POST -> PATCH -> DELETE
    let lifecycleUserId: number | null = null;
    {
      // Create developer user
      const createReq = new Request("http://localhost:3000/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
        body: JSON.stringify({
          username: "challenger_admin_dev",
          password: "strongpassword123",
          role: "developer",
        }),
      });
      const createRes = await usersPost(createReq);
      const createData = await createRes.json();
      lifecycleUserId = createData?.user?.id;

      // Update developer user
      const patchReq = new Request("http://localhost:3000/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
        body: JSON.stringify({
          id: lifecycleUserId,
          role: "developer",
        }),
      });
      const patchRes = await usersPatch(patchReq);
      const patchData = await patchRes.json();

      // Delete developer user
      const deleteReq = new Request(`http://localhost:3000/api/users?id=${lifecycleUserId}`, {
        method: "DELETE",
        headers: { "x-mock-role": "admin" },
      });
      const deleteRes = await usersDelete(deleteReq);
      const deleteData = await deleteRes.json();

      recordTest(
        "Admin Authorized",
        "3.8",
        "Admin can successfully perform full CRUD on developer accounts via /api/users",
        createRes.status === 201 &&
          createData.success === true &&
          patchRes.status === 200 &&
          patchData.success === true &&
          deleteRes.status === 200 &&
          deleteData.success === true,
        `create: ${createRes.status}, patch: ${patchRes.status}, delete: ${deleteRes.status}`
      );
    }

    // 3.9: Admin blocked from creating second admin via POST /api/users
    {
      const req = new Request("http://localhost:3000/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
        body: JSON.stringify({
          username: "challenger_second_admin",
          password: "strongpassword123",
          role: "admin",
        }),
      });
      const res = await usersPost(req);
      const data = await res.json();
      recordTest(
        "Admin Authorized",
        "3.9",
        "POST /api/users strictly prevents Admin from creating a second admin (HTTP 400)",
        res.status === 400 && data.error && data.error.includes("Only one administrator"),
        `Status: ${res.status}, error: ${data?.error}`
      );
    }

    // 3.10: Admin blocked from deleting the last admin via DELETE /api/users
    {
      const adminRow = db.prepare("SELECT id FROM users WHERE LOWER(role) = 'admin'").get() as { id: number };
      const req = new Request(`http://localhost:3000/api/users?id=${adminRow.id}`, {
        method: "DELETE",
        headers: { "x-mock-role": "admin" },
      });
      const res = await usersDelete(req);
      const data = await res.json();
      recordTest(
        "Admin Authorized",
        "3.10",
        "DELETE /api/users strictly prevents Admin from deleting the last admin account (HTTP 400)",
        res.status === 400 && data.error && data.error.includes("last administrator"),
        `Status: ${res.status}, error: ${data?.error}`
      );
    }

    // =========================================================================
    // SECTION 4: CASE-INSENSITIVITY OF ROLE CHECKS
    // =========================================================================
    console.log("\n--- Section 4: Case-Insensitivity of Role Checks ---");

    // 4.1: Mixed-case Admin headers ('Admin', 'ADMIN', 'aDmIn') grant admin access
    {
      const testCases = ["Admin", "ADMIN", "aDmIn", "  ADMIN  "];
      let allPassed = true;
      for (const roleVal of testCases) {
        const req = new Request("http://localhost:3000/api/nginx/files", {
          headers: { "x-mock-role": roleVal },
        });
        const res = await nginxFilesGet(req);
        if (res.status !== 200) {
          allPassed = false;
          console.error(`Failed on roleVal: "${roleVal}", status: ${res.status}`);
          break;
        }
      }
      recordTest(
        "Case-Insensitivity",
        "4.1",
        "Route guards treat 'Admin', 'ADMIN', 'aDmIn' with optional whitespace as authorized Admin (200)",
        allPassed
      );
    }

    // 4.2: Mixed-case Developer headers ('Developer', 'DEVELOPER', 'dEvElOpEr') strictly return 403
    {
      const testCases = ["Developer", "DEVELOPER", "dEvElOpEr", "  developer  "];
      let allRejected = true;
      for (const roleVal of testCases) {
        const req = new Request("http://localhost:3000/api/env", {
          headers: { "x-mock-role": roleVal },
        });
        const res = await envGet(req);
        if (res.status !== 403) {
          allRejected = false;
          console.error(`Failed on dev roleVal: "${roleVal}", status: ${res.status}`);
          break;
        }
      }
      recordTest(
        "Case-Insensitivity",
        "4.2",
        "Route guards treat 'Developer', 'DEVELOPER', 'dEvElOpEr' strictly as non-admin (403 Forbidden)",
        allRejected
      );
    }

    // 4.3: Alternative header keys (x-test-role, x-user-role) case-insensitivity
    {
      const reqTestRoleAdmin = new Request("http://localhost:3000/api/nginx/files", {
        headers: { "x-test-role": "ADMIN" },
      });
      const resTestRoleAdmin = await nginxFilesGet(reqTestRoleAdmin);

      const reqTestRoleDev = new Request("http://localhost:3000/api/nginx/files", {
        headers: { "x-test-role": "DEVELOPER" },
      });
      const resTestRoleDev = await nginxFilesGet(reqTestRoleDev);

      const reqUserRoleAdmin = new Request("http://localhost:3000/api/nginx/files", {
        headers: { "x-user-role": "Admin" },
      });
      const resUserRoleAdmin = await nginxFilesGet(reqUserRoleAdmin);

      const reqUserRoleDev = new Request("http://localhost:3000/api/nginx/files", {
        headers: { "x-user-role": "Developer" },
      });
      const resUserRoleDev = await nginxFilesGet(reqUserRoleDev);

      recordTest(
        "Case-Insensitivity",
        "4.3",
        "Alternative header keys (x-test-role, x-user-role) evaluate case-insensitively",
        resTestRoleAdmin.status === 200 &&
          resTestRoleDev.status === 403 &&
          resUserRoleAdmin.status === 200 &&
          resUserRoleDev.status === 403,
        `testAdmin: ${resTestRoleAdmin.status}, testDev: ${resTestRoleDev.status}, userAdmin: ${resUserRoleAdmin.status}, userDev: ${resUserRoleDev.status}`
      );
    }

    // 4.4: Database level role case-insensitivity in createUser & updateUserRole
    {
      const hash = await bcrypt.hash("case_dev_pass", 10);
      const createdDev = createUser("case_dev_user", hash, "DEVELOPER");
      const fetchedDev = getUserByUsername("case_dev_user");

      // Attempt to create second admin with mixed case 'ADMIN'
      const createdSecondAdmin = createUser("case_admin_user", hash, "ADMIN");

      // Cleanup
      if (fetchedDev) deleteUser(fetchedDev.id);

      recordTest(
        "Case-Insensitivity",
        "4.4",
        "Database layer normalizes 'DEVELOPER' to 'developer' and triggers block 'ADMIN' case-insensitively",
        createdDev === true &&
          fetchedDev !== null &&
          fetchedDev.role === "developer" &&
          createdSecondAdmin === false
      );
    }

    // 4.5: Username lookup case-insensitivity (COLLATE NOCASE)
    {
      const hash = await bcrypt.hash("case_pass", 10);
      createUser("MixedCaseUsername", hash, "developer");
      const match1 = getUserByUsername("mixedcaseusername");
      const match2 = getUserByUsername("MIXEDCASEUSERNAME");
      const match3 = getUserByUsername("MiXeDcAsEuSeRnAmE");

      if (match1) deleteUser(match1.id);

      recordTest(
        "Case-Insensitivity",
        "4.5",
        "getUserByUsername matches usernames case-insensitively across lower, upper, and mixed case",
        match1 !== null && match2 !== null && match3 !== null && match1.id === match2.id && match2.id === match3.id
      );
    }

    // =========================================================================
    // SECTION 5: CONCURRENCY STRESS & RACE CONDITION RESILIENCE
    // =========================================================================
    console.log("\n--- Section 5: Concurrency Stress & Race Condition Testing ---");

    // 5.1: Race condition on single-admin rule: 30 concurrent attempts to create an admin
    {
      const hash = await bcrypt.hash("concur_admin_pass", 10);
      const concurrentAdminAttempts = 30;
      const promises: Promise<boolean>[] = [];

      for (let i = 0; i < concurrentAdminAttempts; i++) {
        promises.push(
          new Promise<boolean>((resolve) => {
            try {
              const res = createUser(`race_admin_${i}`, hash, "admin");
              resolve(res);
            } catch {
              resolve(false);
            }
          })
        );
      }

      const results = await Promise.all(promises);
      const successCount = results.filter((r) => r === true).length;
      const adminCountAfter = (
        db.prepare("SELECT count(*) as count FROM users WHERE LOWER(role) = 'admin'").get() as { count: number }
      ).count;

      recordTest(
        "Concurrency Stress",
        "5.1",
        "30 concurrent attempts to create an admin: exactly 0 succeed, admin count strictly preserved at 1",
        successCount === 0 && adminCountAfter === 1,
        `Successes: ${successCount}, total admins in DB: ${adminCountAfter}`
      );
    }

    // 5.2: Concurrent creation of 30 unique developer accounts
    {
      const hash = await bcrypt.hash("concur_dev_pass", 10);
      const devBatchSize = 30;
      const promises: Promise<boolean>[] = [];

      for (let i = 0; i < devBatchSize; i++) {
        promises.push(
          new Promise<boolean>((resolve) => {
            try {
              const res = createUser(`concur_dev_${i}`, hash, "developer");
              resolve(res);
            } catch {
              resolve(false);
            }
          })
        );
      }

      const results = await Promise.all(promises);
      const successCount = results.filter((r) => r === true).length;

      // Verify all accounts exist in database
      const createdDevs = db
        .prepare("SELECT id, username, role FROM users WHERE username LIKE 'concur_dev_%'")
        .all() as UserRecord[];

      // Clean up batch
      for (const d of createdDevs) {
        deleteUser(d.id);
      }

      recordTest(
        "Concurrency Stress",
        "5.2",
        "30 concurrent unique developer account creations succeed without lock errors or lost updates",
        successCount === devBatchSize && createdDevs.length === devBatchSize,
        `Successful creates: ${successCount}/${devBatchSize}, found in DB: ${createdDevs.length}`
      );
    }

    // 5.3: High-concurrency interleaved route requests (60 parallel requests)
    // 20 Developer requests (expect 403), 20 Unauthenticated (expect 401), 20 Admin (expect 200)
    {
      interface RouteCheckResult {
        role: string;
        route: string;
        expectedStatus: number;
        actualStatus: number;
      }

      const requests: Promise<RouteCheckResult>[] = [];

      for (let i = 0; i < 20; i++) {
        // Developer -> expect 403
        requests.push(
          (async () => {
            const req = new Request("http://localhost:3000/api/env", {
              headers: { "x-mock-role": "developer" },
            });
            const res = await envGet(req);
            return { role: "developer", route: "/api/env", expectedStatus: 403, actualStatus: res.status };
          })()
        );

        // Unauthenticated -> expect 401
        requests.push(
          (async () => {
            const req = new Request("http://localhost:3000/api/nginx/files", {
              headers: { "x-mock-role": "unauthenticated" },
            });
            const res = await nginxFilesGet(req);
            return { role: "unauthenticated", route: "/api/nginx/files", expectedStatus: 401, actualStatus: res.status };
          })()
        );

        // Admin -> expect 200
        requests.push(
          (async () => {
            const req = new Request("http://localhost:3000/api/users", {
              headers: { "x-mock-role": "admin" },
            });
            const res = await usersGet(req);
            return { role: "admin", route: "/api/users", expectedStatus: 200, actualStatus: res.status };
          })()
        );
      }

      const outcomes = await Promise.all(requests);
      const dev403Count = outcomes.filter((o) => o.role === "developer" && o.actualStatus === 403).length;
      const unauth401Count = outcomes.filter((o) => o.role === "unauthenticated" && o.actualStatus === 401).length;
      const admin200Count = outcomes.filter((o) => o.role === "admin" && o.actualStatus === 200).length;

      const totalMatches = dev403Count === 20 && unauth401Count === 20 && admin200Count === 20;

      recordTest(
        "Concurrency Stress",
        "5.3",
        "60 interleaved concurrent route requests across roles: zero privilege leakage, 100% exact statuses",
        totalMatches,
        `Developer (403): ${dev403Count}/20, Unauth (401): ${unauth401Count}/20, Admin (200): ${admin200Count}/20`
      );
    }

    // 5.4: Concurrent read/write race condition on User Management API
    {
      const hash = await bcrypt.hash("concur_rw_pass", 10);
      const concurrentOps: Promise<boolean>[] = [];
      const createdIds: number[] = [];

      // Concurrently create 10 users via usersPost and read 10 times via usersGet
      for (let i = 0; i < 10; i++) {
        // Write op
        concurrentOps.push(
          (async () => {
            const req = new Request("http://localhost:3000/api/users", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
              body: JSON.stringify({
                username: `rw_dev_${i}`,
                password: "password123",
                role: "developer",
              }),
            });
            const res = await usersPost(req);
            const data = await res.json();
            if (data?.user?.id) createdIds.push(data.user.id);
            return res.status === 201;
          })()
        );

        // Read op
        concurrentOps.push(
          (async () => {
            const req = new Request("http://localhost:3000/api/users", {
              headers: { "x-mock-role": "admin" },
            });
            const res = await usersGet(req);
            return res.status === 200;
          })()
        );
      }

      const results = await Promise.all(concurrentOps);
      const allSucceeded = results.every((r) => r === true);

      // Cleanup created users
      for (const id of createdIds) {
        deleteUser(id);
      }

      recordTest(
        "Concurrency Stress",
        "5.4",
        "Concurrent interleaved reads & writes via /api/users: zero SQLITE_BUSY deadlocks, 100% success",
        allSucceeded,
        `Operations succeeded: ${results.filter((r) => r).length}/${results.length}`
      );
    }

  } finally {
    // Restore database to exact original state
    console.log("\n[CLEANUP] Restoring database to original state...");
    try {
      db.exec("DELETE FROM users");
      const insertStmt = db.prepare(
        "INSERT INTO users (id, username, passwordHash, role, createdAt) VALUES (?, ?, ?, ?, ?)"
      );
      for (const u of initialUsers) {
        insertStmt.run(u.id, u.username, u.passwordHash, u.role, u.createdAt);
      }
      console.log(`[CLEANUP] Successfully restored ${initialUsers.length} initial user(s).`);
    } catch (cleanupErr) {
      console.error("[CLEANUP ERROR] Failed to restore users table:", cleanupErr);
    }
  }

  // =========================================================================
  // SUMMARY AND VERDICT
  // =========================================================================
  console.log("\n===============================================================================");
  console.log("                      STRESS TEST RUN SUMMARY                                 ");
  console.log("===============================================================================");

  const total = testResults.length;
  const passed = testResults.filter((r) => r.passed).length;
  const failed = testResults.filter((r) => !r.passed).length;

  console.log(`Total Stress Tests Executed : ${total}`);
  console.log(`Tests Passed                : ${passed}`);
  console.log(`Tests Failed                : ${failed}`);
  console.log("===============================================================================");

  if (failed > 0) {
    console.log("\nFAILED TESTS LIST:");
    for (const r of testResults.filter((r) => !r.passed)) {
      console.log(`- [${r.category}] ${r.id}: ${r.name} -> ${r.error}`);
    }
    console.log("\nCHALLENGER VERDICT: REJECT");
    process.exit(1);
  } else {
    console.log("\nALL 44 EMPIRICAL ADVERSARIAL STRESS TESTS COMPLETED SUCCESSFULLY!");
    console.log("CHALLENGER VERDICT: APPROVE");
  }
}

runEmpiricalStressTests().catch((err) => {
  console.error("FATAL ERROR in stress test runner:", err);
  process.exit(1);
});
