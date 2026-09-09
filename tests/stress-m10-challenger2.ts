/**
 * Adversarial Stress & RBAC Compliance Test Suite for Milestone 10: Fail2Ban Security Shield
 * Challenger 2: Empirical Verification, RBAC Boundaries & Idempotency Probing
 *
 * Verifies:
 * 1. Developer Role RBAC Isolation:
 *    - POST /api/fail2ban/unban with Developer session cookie -> strictly HTTP 403 Forbidden
 *    - POST /api/fail2ban/unban with Developer token/header -> strictly HTTP 403 Forbidden
 *    - Developer has read-only access: GET /api/fail2ban -> HTTP 200 OK
 * 2. Unauthenticated Anonymous Access Lockdown:
 *    - GET /api/fail2ban anonymously (no session cookie/headers) -> strictly HTTP 401 Unauthorized
 *    - POST /api/fail2ban/unban anonymously (no session cookie/headers) -> strictly HTTP 401 Unauthorized
 * 3. Admin Role Authorization & Unban Functionality:
 *    - POST /api/fail2ban/unban with Admin session cookie -> HTTP 200 OK & target IP unbanned
 *    - POST /api/fail2ban/unban with Admin token/header -> HTTP 200 OK & target IP unbanned
 *    - Verification that subsequent GET /api/fail2ban reflects removal of unbanned IP while preserving others
 * 4. Idempotency & Concurrency Stress:
 *    - Sequential repeated unban calls for already-unbanned IP -> strictly HTTP 200 OK, no 500 or exceptions
 *    - Concurrent unban flood (Promise.all) -> all resolve HTTP 200 OK without race conditions
 *    - In-memory store integrity: mock store maintains clean state without corruption or duplicate entries
 * 5. Adversarial Input Boundaries & Shell Injection Immunity:
 *    - Shell metacharacters in IP address (&, ;, |, `, $, >, <, etc.) -> HTTP 400 Bad Request
 *    - Shell metacharacters in jail name -> HTTP 400 Bad Request
 *    - Missing body, missing IP, missing jail, empty strings, whitespace -> HTTP 400 Bad Request
 *    - Role spoofing attempts (e.g. 'superadmin', 'root') -> fail-closed with HTTP 403 Forbidden
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import { MockE2EServer } from "./e2e/mock-server";
import { TestClient } from "./e2e/client";
import { GET as fail2banGet } from "../src/app/api/fail2ban/route";
import { POST as fail2banUnbanPost } from "../src/app/api/fail2ban/unban/route";
import {
  getFail2BanStatus,
  unbanIp,
  resetMockFail2BanStore,
  getMockStore,
  validateIp,
  validateJail,
  hasShellMetachars,
  Fail2BanError,
} from "../src/lib/fail2ban-service";
import { requireAuth, requireAdmin } from "../src/lib/auth-guard";

interface TestCase {
  id: string;
  name: string;
  category: string;
  passed: boolean;
  error?: string;
}

const testResults: TestCase[] = [];

async function probe(
  id: string,
  category: string,
  name: string,
  fn: () => Promise<void> | void
) {
  try {
    await fn();
    testResults.push({ id, category, name, passed: true });
    console.log(`  ✓ [PASS] Probe ${id} (${category}): ${name}`);
  } catch (err: any) {
    const msg = err?.message || String(err);
    testResults.push({ id, category, name, passed: false, error: msg });
    console.error(`  ✗ [FAIL] Probe ${id} (${category}): ${name}`);
    console.error(`           Error: ${msg}`);
    if (err.stack) {
      console.error(
        `           Stack: ${err.stack
          .split("\n")
          .slice(1, 3)
          .join("\n")}`
      );
    }
  }
}

async function runChallenger2Suite() {
  console.log("================================================================================");
  console.log("  CHALLENGER 2: ADVERSARIAL RBAC & IDEMPOTENCY HARNESS - MILESTONE 10 FAIL2BAN  ");
  console.log("================================================================================\n");

  // ===========================================================================
  // SECTION 1: E2E Network & Session Cookie RBAC Probing (MockE2EServer)
  // ===========================================================================
  console.log("--- Section 1: E2E Network & Session Cookie RBAC Probing ---");

  const mockServer = new MockE2EServer();
  const port = await mockServer.start(0);
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Ephemeral test server active on ${baseUrl}`);

  try {
    const adminClient = new TestClient(baseUrl);
    // Authenticate admin
    await adminClient.setupAdmin("admin", "password123");
    const adminLoginRes = await adminClient.login("admin", "password123");
    assert.strictEqual(adminLoginRes.success, true, "Admin login must succeed");

    const devClient = new TestClient(baseUrl);
    // Authenticate developer
    const devLoginRes = await devClient.login("developer", "password123");
    assert.strictEqual(devLoginRes.success, true, "Developer login must succeed");

    const anonClient = new TestClient(baseUrl);

    // 1.1: Developer role access blocked with HTTP 403 via session cookie
    await probe(
      "1.1",
      "Network RBAC",
      "POST /api/fail2ban/unban with Developer session cookie returns strictly HTTP 403 Forbidden",
      async () => {
        const res = await devClient.post("/api/fail2ban/unban", {
          jail: "sshd",
          ip: "192.168.1.100",
        });
        assert.strictEqual(
          res.status,
          403,
          `Expected HTTP 403 Forbidden for Developer session cookie, got ${res.status}`
        );
      }
    );

    // 1.2: Developer role allowed read-only GET /api/fail2ban via session cookie
    await probe(
      "1.2",
      "Network RBAC",
      "GET /api/fail2ban with Developer session cookie returns HTTP 200 OK (read-only allowed)",
      async () => {
        const res = await devClient.get("/api/fail2ban");
        assert.strictEqual(
          res.status,
          200,
          `Expected HTTP 200 OK for Developer session on GET, got ${res.status}`
        );
        assert.strictEqual(res.data.success, true);
        assert.ok(Array.isArray(res.data.jails));
        assert.ok(Array.isArray(res.data.bannedList));
      }
    );

    // 1.3: Unauthenticated anonymous GET /api/fail2ban returns HTTP 401
    await probe(
      "1.3",
      "Network Auth",
      "GET /api/fail2ban anonymously (no session cookie) returns strictly HTTP 401 Unauthorized",
      async () => {
        const res = await anonClient.get("/api/fail2ban");
        assert.strictEqual(
          res.status,
          401,
          `Expected HTTP 401 Unauthorized for anonymous GET, got ${res.status}`
        );
      }
    );

    // 1.4: Unauthenticated anonymous POST /api/fail2ban/unban returns HTTP 401
    await probe(
      "1.4",
      "Network Auth",
      "POST /api/fail2ban/unban anonymously (no session cookie) returns strictly HTTP 401 Unauthorized",
      async () => {
        const res = await anonClient.post("/api/fail2ban/unban", {
          jail: "sshd",
          ip: "192.168.1.100",
        });
        assert.strictEqual(
          res.status,
          401,
          `Expected HTTP 401 Unauthorized for anonymous POST, got ${res.status}`
        );
      }
    );

    // 1.5: Admin role successfully calls POST /api/fail2ban/unban via session cookie
    await probe(
      "1.5",
      "Network Admin",
      "POST /api/fail2ban/unban with Admin session cookie returns HTTP 200 and unbans target IP",
      async () => {
        const res = await adminClient.post("/api/fail2ban/unban", {
          jail: "sshd",
          ip: "192.168.1.100",
        });
        assert.strictEqual(
          res.status,
          200,
          `Expected HTTP 200 OK for Admin session on unban, got ${res.status}`
        );
        assert.strictEqual(res.data.success, true);
        assert.ok(
          typeof res.data.message === "string" && res.data.message.includes("192.168.1.100")
        );
      }
    );

    // 1.6: Network Idempotency: repeated unban calls over HTTP for same IP return HTTP 200
    await probe(
      "1.6",
      "Network Idempotency",
      "Repeated unban calls over HTTP (5x) for same IP return HTTP 200 without throwing exceptions",
      async () => {
        for (let i = 1; i <= 5; i++) {
          const res = await adminClient.post("/api/fail2ban/unban", {
            jail: "sshd",
            ip: "192.168.1.100",
          });
          assert.strictEqual(
            res.status,
            200,
            `Iteration ${i}: Expected HTTP 200 on repeated unban, got ${res.status}`
          );
          assert.strictEqual(res.data.success, true);
        }
      }
    );
  } finally {
    await mockServer.stop();
    console.log("Ephemeral test server stopped.\n");
  }

  // ===========================================================================
  // SECTION 2: Direct Route Handler RBAC & Auth Guard Probing
  // ===========================================================================
  console.log("--- Section 2: Direct Route Handler RBAC & Auth Guard Probing ---");

  // 2.1: Developer role access blocked with HTTP 403
  await probe(
    "2.1",
    "Route RBAC",
    "POST /api/fail2ban/unban with x-mock-role: developer returns strictly HTTP 403 Forbidden",
    async () => {
      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "developer",
        },
        body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(
        res.status,
        403,
        `Expected HTTP 403 Forbidden for Developer role, got ${res.status}`
      );
      const data = await res.json();
      assert.ok(
        data.error.toLowerCase().includes("forbidden") ||
          data.error.toLowerCase().includes("admin"),
        `Error message must indicate forbidden access: ${data.error}`
      );
    }
  );

  // 2.2: Developer role alternative token header (x-test-role) blocked with HTTP 403
  await probe(
    "2.2",
    "Route RBAC",
    "POST /api/fail2ban/unban with x-test-role: developer returns strictly HTTP 403 Forbidden",
    async () => {
      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-role": "developer",
        },
        body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(
        res.status,
        403,
        `Expected HTTP 403 Forbidden for x-test-role developer, got ${res.status}`
      );
    }
  );

  // 2.3: Developer role case insensitivity check (DeVeLoPeR) returns HTTP 403
  await probe(
    "2.3",
    "Route RBAC",
    "POST /api/fail2ban/unban with x-mock-role: DeVeLoPeR returns strictly HTTP 403 Forbidden",
    async () => {
      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "DeVeLoPeR",
        },
        body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(
        res.status,
        403,
        `Expected HTTP 403 for mixed-case DeVeLoPeR role, got ${res.status}`
      );
    }
  );

  // 2.4: Developer role is allowed read-only GET /api/fail2ban
  await probe(
    "2.4",
    "Route RBAC",
    "GET /api/fail2ban with Developer role returns HTTP 200 OK with active jails and banned IPs",
    async () => {
      resetMockFail2BanStore();
      const req = new Request("http://localhost:3000/api/fail2ban", {
        method: "GET",
        headers: { "x-mock-role": "developer" },
      });
      const res = await fail2banGet(req);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(Array.isArray(data.jails) && data.jails.length > 0);
      assert.ok(Array.isArray(data.bannedList) && data.bannedList.length > 0);
    }
  );

  // 2.5: Anonymous request to GET /api/fail2ban returns HTTP 401
  await probe(
    "2.5",
    "Route Auth",
    "GET /api/fail2ban with x-mock-role: anonymous returns strictly HTTP 401 Unauthorized",
    async () => {
      const req = new Request("http://localhost:3000/api/fail2ban", {
        method: "GET",
        headers: { "x-mock-role": "anonymous" },
      });
      const res = await fail2banGet(req);
      assert.strictEqual(
        res.status,
        401,
        `Expected HTTP 401 for anonymous GET, got ${res.status}`
      );
    }
  );

  // 2.6: Bare Request (no auth headers at all) to GET /api/fail2ban returns HTTP 401
  await probe(
    "2.6",
    "Route Auth",
    "GET /api/fail2ban with bare Request (no headers) returns strictly HTTP 401 Unauthorized",
    async () => {
      const req = new Request("http://localhost:3000/api/fail2ban", {
        method: "GET",
      });
      const res = await fail2banGet(req);
      assert.strictEqual(
        res.status,
        401,
        `Expected HTTP 401 for bare unauthenticated GET, got ${res.status}`
      );
    }
  );

  // 2.7: Anonymous request to POST /api/fail2ban/unban returns HTTP 401
  await probe(
    "2.7",
    "Route Auth",
    "POST /api/fail2ban/unban with x-mock-role: anonymous returns strictly HTTP 401 Unauthorized",
    async () => {
      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "anonymous",
        },
        body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(
        res.status,
        401,
        `Expected HTTP 401 for anonymous unban, got ${res.status}`
      );
    }
  );

  // 2.8: Bare Request (no auth headers) to POST /api/fail2ban/unban returns HTTP 401
  await probe(
    "2.8",
    "Route Auth",
    "POST /api/fail2ban/unban with bare Request (no headers) returns strictly HTTP 401 Unauthorized",
    async () => {
      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(
        res.status,
        401,
        `Expected HTTP 401 for bare unauthenticated unban, got ${res.status}`
      );
    }
  );

  // 2.9: Admin role call to POST /api/fail2ban/unban succeeds (HTTP 200) and unbans IP
  await probe(
    "2.9",
    "Route Admin",
    "POST /api/fail2ban/unban with Admin role succeeds (HTTP 200) and unbans target IP",
    async () => {
      resetMockFail2BanStore();
      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "admin",
        },
        body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.message.includes("192.168.1.100"));

      // Verify unbanned from store query
      const checkReq = new Request("http://localhost:3000/api/fail2ban", {
        method: "GET",
        headers: { "x-mock-role": "admin" },
      });
      const checkRes = await fail2banGet(checkReq);
      const checkData = await checkRes.json();
      const target = checkData.bannedList.find(
        (b: any) => b.ip === "192.168.1.100" && b.jail === "sshd"
      );
      assert.strictEqual(target, undefined, "192.168.1.100 must be removed from bannedList");

      // Verify other banned IPs are preserved
      const preserved = checkData.bannedList.find(
        (b: any) => b.ip === "10.0.0.55" && b.jail === "nginx-http-auth"
      );
      assert.ok(preserved, "10.0.0.55 in nginx-http-auth must remain in store");
    }
  );

  // ===========================================================================
  // SECTION 3: Idempotency, Concurrency & Store Integrity Probing
  // ===========================================================================
  console.log("\n--- Section 3: Idempotency, Concurrency & Store Integrity Probing ---");

  // 3.1: Sequential unban idempotency: 10 repeated calls for same IP return HTTP 200
  await probe(
    "3.1",
    "Idempotency",
    "Sequential unban calls (10x) for already-unbanned IP strictly return HTTP 200 without throwing",
    async () => {
      resetMockFail2BanStore();
      // First unban
      const firstReq = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "admin",
        },
        body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
      });
      const firstRes = await fail2banUnbanPost(firstReq);
      assert.strictEqual(firstRes.status, 200);

      // Subsequent 9 repeated unbans for the same IP
      for (let i = 2; i <= 10; i++) {
        const repeatReq = new Request("http://localhost:3000/api/fail2ban/unban", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mock-role": "admin",
          },
          body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
        });
        const repeatRes = await fail2banUnbanPost(repeatReq);
        assert.strictEqual(
          repeatRes.status,
          200,
          `Sequential unban iteration ${i} failed with status ${repeatRes.status}`
        );
        const data = await repeatRes.json();
        assert.strictEqual(data.success, true);
      }
    }
  );

  // 3.2: Concurrent unban spam: 10 concurrent unban calls for same IP
  await probe(
    "3.2",
    "Concurrency",
    "Concurrent unban spam (10 concurrent requests) all resolve with HTTP 200 and no race-condition 500",
    async () => {
      resetMockFail2BanStore();

      const promises = Array.from({ length: 10 }, (_, i) => {
        const req = new Request("http://localhost:3000/api/fail2ban/unban", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mock-role": "admin",
          },
          body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
        });
        return fail2banUnbanPost(req);
      });

      const responses = await Promise.all(promises);
      for (let i = 0; i < responses.length; i++) {
        assert.strictEqual(
          responses[i].status,
          200,
          `Concurrent request ${i + 1} returned status ${responses[i].status}`
        );
        const data = await responses[i].json();
        assert.strictEqual(data.success, true);
      }
    }
  );

  // 3.3: Store state verification after repeated operations
  await probe(
    "3.3",
    "Store Integrity",
    "In-memory mock store remains healthy and uncorrupted after spam attacks",
    async () => {
      const store = getMockStore();
      assert.ok(Array.isArray(store.jails), "store.jails must be an array");
      assert.ok(Array.isArray(store.bannedList), "store.bannedList must be an array");
      assert.strictEqual(
        store.jails.length,
        3,
        "store.jails must retain exactly the 3 default jails"
      );
      assert.ok(store.jails.includes("sshd"));
      assert.ok(store.jails.includes("nginx-http-auth"));
      assert.ok(store.jails.includes("pmmanager-auth"));

      // Ensure no undefined or null entries in bannedList
      for (const item of store.bannedList) {
        assert.ok(item && typeof item === "object", "Entry must be a valid object");
        assert.ok(typeof item.ip === "string", "Entry IP must be a string");
        assert.ok(typeof item.jail === "string", "Entry jail must be a string");
      }
    }
  );

  // 3.4: Service layer unbanIp idempotency directly
  await probe(
    "3.4",
    "Service Idempotency",
    "Direct service unbanIp() call on non-existent IP returns success without error",
    async () => {
      const res = await unbanIp({ jail: "sshd", ip: "198.51.100.99" });
      assert.strictEqual(res.success, true);
      assert.ok(res.message.includes("198.51.100.99"));
    }
  );

  // ===========================================================================
  // SECTION 4: Adversarial Input Boundaries & Injection Attacks
  // ===========================================================================
  console.log("\n--- Section 4: Adversarial Input Boundaries & Injection Attacks ---");

  // 4.1: Shell metacharacter injection in IP
  await probe(
    "4.1",
    "Security Injection",
    "Shell metacharacter injection in IP parameter is strictly blocked with HTTP 400",
    async () => {
      const attackPayloads = [
        "192.168.1.1; whoami",
        "10.0.0.1 && cat /etc/passwd",
        "127.0.0.1 | id",
        "`echo pwned`",
        "$(whoami)",
        "192.168.1.1 > /tmp/hacked",
        "192.168.1.1 < /dev/null",
        "192.168.1.1\\escaped",
        "192.168.1.1!danger",
      ];

      for (const badIp of attackPayloads) {
        const req = new Request("http://localhost:3000/api/fail2ban/unban", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mock-role": "admin",
          },
          body: JSON.stringify({ jail: "sshd", ip: badIp }),
        });
        const res = await fail2banUnbanPost(req);
        assert.strictEqual(
          res.status,
          400,
          `Expected HTTP 400 for malicious IP "${badIp}", got ${res.status}`
        );
      }
    }
  );

  // 4.2: Shell metacharacter injection in Jail
  await probe(
    "4.2",
    "Security Injection",
    "Shell metacharacter injection in jail parameter is strictly blocked with HTTP 400",
    async () => {
      const attackJails = [
        "sshd; ls -la",
        "sshd && whoami",
        "sshd | id",
        "`uptime`",
        "sshd$(id)",
      ];

      for (const badJail of attackJails) {
        const req = new Request("http://localhost:3000/api/fail2ban/unban", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mock-role": "admin",
          },
          body: JSON.stringify({ jail: badJail, ip: "192.168.1.100" }),
        });
        const res = await fail2banUnbanPost(req);
        assert.strictEqual(
          res.status,
          400,
          `Expected HTTP 400 for malicious jail "${badJail}", got ${res.status}`
        );
      }
    }
  );

  // 4.3: Malformed IP formats rejected
  await probe(
    "4.3",
    "Input Validation",
    "Malformed IP formats (non-IP strings, out-of-range octets) rejected with HTTP 400",
    async () => {
      const invalidIps = [
        "not.an.ip.address",
        "999.999.999.999",
        "256.0.0.1",
        "1.2.3.4.5",
        "192.168.1",
        "192.168.1.",
        "",
        "   ",
      ];

      for (const ip of invalidIps) {
        const req = new Request("http://localhost:3000/api/fail2ban/unban", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mock-role": "admin",
          },
          body: JSON.stringify({ jail: "sshd", ip }),
        });
        const res = await fail2banUnbanPost(req);
        assert.strictEqual(
          res.status,
          400,
          `Expected HTTP 400 for invalid IP "${ip}", got ${res.status}`
        );
      }
    }
  );

  // 4.4: Missing parameters & malformed JSON
  await probe(
    "4.4",
    "Boundary Validation",
    "Missing parameters and malformed JSON return HTTP 400 Bad Request",
    async () => {
      // Missing body
      const req1 = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
        body: "invalid-json-syntax{",
      });
      const res1 = await fail2banUnbanPost(req1);
      assert.strictEqual(res1.status, 400);

      // Empty object
      const req2 = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
        body: JSON.stringify({}),
      });
      const res2 = await fail2banUnbanPost(req2);
      assert.strictEqual(res2.status, 400);

      // Missing IP
      const req3 = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
        body: JSON.stringify({ jail: "sshd" }),
      });
      const res3 = await fail2banUnbanPost(req3);
      assert.strictEqual(res3.status, 400);

      // Missing Jail
      const req4 = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mock-role": "admin" },
        body: JSON.stringify({ ip: "192.168.1.100" }),
      });
      const res4 = await fail2banUnbanPost(req4);
      assert.strictEqual(res4.status, 400);
    }
  );

  // 4.5: Role spoofing attempts fail-closed
  await probe(
    "4.5",
    "Privilege Escalation",
    "Unknown or spoofed roles (superadmin, root, guest) fail-closed with HTTP 403 Forbidden",
    async () => {
      const spoofedRoles = ["superadmin", "root", "guest", "system", "operator"];
      for (const fakeRole of spoofedRoles) {
        const req = new Request("http://localhost:3000/api/fail2ban/unban", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mock-role": fakeRole,
          },
          body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
        });
        const res = await fail2banUnbanPost(req);
        assert.strictEqual(
          res.status,
          403,
          `Expected HTTP 403 Forbidden for spoofed role "${fakeRole}", got ${res.status}`
        );
      }
    }
  );

  // ===========================================================================
  // SECTION 5: Production Fail-Closed Lockdown Verification
  // ===========================================================================
  console.log("\n--- Section 5: Production Fail-Closed Lockdown Verification ---");

  await probe(
    "5.1",
    "Production Guard",
    "In NODE_ENV=production, mock role headers are strictly rejected returning HTTP 401",
    async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "production";
        const req = new Request("http://localhost:3000/api/fail2ban/unban", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mock-role": "admin",
          },
          body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
        });
        const res = await fail2banUnbanPost(req);
        assert.strictEqual(
          res.status,
          401,
          `Expected HTTP 401 when mock role header is used in production, got ${res.status}`
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    }
  );

  // ===========================================================================
  // Summary & Gate Decision
  // ===========================================================================
  console.log("\n================================================================================");
  console.log("                        CHALLENGER 2 TEST RESULTS SUMMARY                       ");
  console.log("================================================================================");

  const total = testResults.length;
  const passed = testResults.filter((r) => r.passed).length;
  const failed = testResults.filter((r) => !r.passed).length;

  console.log(`Total Probes Executed : ${total}`);
  console.log(`Passed                : ${passed}`);
  console.log(`Failed                : ${failed}`);
  console.log(`Success Rate          : ${((passed / total) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.error(`\nGATE VERDICT: REJECT - ${failed} probe(s) failed.`);
    process.exit(1);
  } else {
    console.log(`\nGATE VERDICT: APPROVE - All ${total} adversarial probes passed cleanly.`);
  }
}

runChallenger2Suite().catch((err) => {
  console.error("\nFatal test execution error:", err);
  process.exit(1);
});
