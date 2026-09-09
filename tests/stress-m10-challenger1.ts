/**
 * Milestone 10: Fail2Ban Security Shield - Adversarial Challenger Stress Test Suite
 *
 * Designed and executed by teamwork_preview_challenger (Challenger 1).
 *
 * Core Probing Areas:
 * 1. Malicious IP & Jail inputs:
 *    - Shell metacharacters: `192.168.1.1; whoami`, `10.0.0.1 && cat /etc/passwd`,
 *      `127.0.0.1 | id`, `` `echo pwned` ``, `$(whoami)`
 *    - Path traversal strings: `../../../../etc/passwd`, `..\\..\\windows\\system32\\calc.exe`, etc.
 *    - Exotic vectors: newlines, null bytes, backslashes, redirects, subshells
 * 2. Missing fields & malformed payloads:
 *    - Null ip, null jail, empty strings, whitespace
 *    - Non-numeric strings in ports/IPs (`192.168.1.1:8080`, `192.168.1.abc`, `localhost`, `999.999.999.999`)
 *    - Type juggling: numbers, booleans, objects, arrays
 *    - Malformed JSON and missing bodies
 * 3. Boundary handling:
 *    - Unbanning an IP that is NOT banned (must return 200/404 gracefully without 500)
 *    - Unbanning from a non-existent jail name
 *    - IPv6 edge cases (`::1`, compressed, standard)
 *    - ReDoS / Extreme length boundary payloads (50,000 chars)
 * 4. High-concurrency unban bursts & mock store consistency:
 *    - 50 concurrent requests targeting the same banned IP
 *    - 50 concurrent requests unbanning 25 of 50 newly injected mock IPs
 *    - Interleaved 30 GET reads + 20 POST unbans simultaneously
 *    - 50 concurrent unbans for non-existent IPs
 * 5. RBAC & Auth Guard Security:
 *    - Developer role locked out (403) across all vectors
 *    - Unauthenticated requests locked out (401)
 *    - Privilege escalation resistance
 */

process.env.NODE_ENV = "test";

import assert from "node:assert";
import {
  getFail2BanStatus,
  unbanIp,
  validateIp,
  validateJail,
  hasShellMetachars,
  getMockStore,
  resetMockFail2BanStore,
  Fail2BanError,
  SHELL_METACHAR_REGEX,
  JAIL_NAME_REGEX,
  IPV4_REGEX,
  IPV6_REGEX,
} from "../src/lib/fail2ban-service";
import { GET as fail2banGet } from "../src/app/api/fail2ban/route";
import { POST as fail2banUnbanPost } from "../src/app/api/fail2ban/unban/route";

async function runChallengerSuite() {
  console.log("================================================================================");
  console.log("  CHALLENGER 1: ADVERSARIAL STRESS TEST SUITE (MILESTONE 10)");
  console.log("  Probing: Fail2Ban Command Injection, Input Boundaries & High-Concurrency Bursts");
  console.log("================================================================================\n");

  let totalProbes = 0;
  let passedProbes = 0;

  async function probe(name: string, fn: () => void | Promise<void>) {
    totalProbes++;
    try {
      await fn();
      console.log(`  ✓ [PASS] ${name}`);
      passedProbes++;
    } catch (err: any) {
      console.error(`  ✗ [FAIL] ${name}`);
      console.error(`    Details: ${err.message}`);
      if (err.stack) {
        console.error(
          `    Stack: ${err.stack
            .split("\n")
            .slice(1, 4)
            .join("\n")}`
        );
      }
      throw err;
    }
  }

  // =========================================================================
  // PROBE SUITE 1: Malicious Command Injection & Path Traversal Vectors
  // =========================================================================
  console.log("--- PROBE SUITE 1: Malicious Command Injection & Path Traversal Vectors ---");

  await probe("1.1: Classic shell metacharacters in IP are blocked at service and route levels", async () => {
    const vectors = [
      "192.168.1.1; whoami",
      "10.0.0.1 && cat /etc/passwd",
      "127.0.0.1 | id",
      "`echo pwned`",
      "$(whoami)",
      "192.168.1.1; rm -rf /",
      "10.0.0.1 || reboot",
      "127.0.0.1 > /tmp/pwned",
      "127.0.0.1 < /etc/shadow",
      "127.0.0.1 & calc.exe",
      "127.0.0.1!127.0.0.1",
      "127.0.0.1\\whoami",
      "127.0.0.1 (id)",
    ];

    for (const vector of vectors) {
      // 1. Service-level check
      const check = validateIp(vector);
      assert.strictEqual(
        check.valid,
        false,
        `validateIp should reject injection vector: "${vector}"`
      );

      await assert.rejects(
        async () => {
          await unbanIp({ jail: "sshd", ip: vector });
        },
        (err: any) => err instanceof Fail2BanError && err.statusCode === 400,
        `unbanIp should throw Fail2BanError(400) for vector: "${vector}"`
      );

      // 2. API Route handler check
      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "admin",
        },
        body: JSON.stringify({ jail: "sshd", ip: vector }),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(
        res.status,
        400,
        `Route should return HTTP 400 for injection vector: "${vector}", got ${res.status}`
      );
      const data = await res.json();
      assert.ok(data.error, `Response should contain error for vector "${vector}"`);
    }
  });

  await probe("1.2: Path traversal vectors in IP parameter are strictly rejected", async () => {
    const traversalVectors = [
      "../../../../etc/passwd",
      "..\\..\\windows\\system32\\calc.exe",
      "../../var/log/fail2ban.log",
      "/etc/shadow",
      "C:\\Windows\\System32\\cmd.exe",
      "../../../dev/null",
      "..%2f..%2fetc%2fpasswd",
    ];

    for (const vector of traversalVectors) {
      const check = validateIp(vector);
      assert.strictEqual(
        check.valid,
        false,
        `validateIp should reject path traversal vector: "${vector}"`
      );

      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "admin",
        },
        body: JSON.stringify({ jail: "sshd", ip: vector }),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(
        res.status,
        400,
        `Expected HTTP 400 for path traversal IP "${vector}", got ${res.status}`
      );
    }
  });

  await probe("1.3: Injection and path traversal vectors in jail parameter are strictly rejected", async () => {
    const badJails = [
      "../../../../etc/shadow",
      "..\\..\\windows\\system32\\cmd.exe",
      "sshd; whoami",
      "nginx && cat /etc/passwd",
      "pmmanager | id",
      "`echo pwned`",
      "$(id)",
      "jail/with/slash",
      "jail\\with\\backslash",
      "jail with spaces",
      "jail\0nullbyte",
    ];

    for (const badJail of badJails) {
      const check = validateJail(badJail);
      assert.strictEqual(
        check.valid,
        false,
        `validateJail should reject invalid jail: "${badJail}"`
      );

      await assert.rejects(
        async () => {
          await unbanIp({ jail: badJail, ip: "192.168.1.1" });
        },
        (err: any) => err instanceof Fail2BanError && err.statusCode === 400
      );

      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "admin",
        },
        body: JSON.stringify({ jail: badJail, ip: "192.168.1.1" }),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(
        res.status,
        400,
        `Expected HTTP 400 for invalid jail "${badJail}", got ${res.status}`
      );
    }
  });

  await probe("1.4: Exotic injection vectors (newlines, embedded carriage returns) are rejected", async () => {
    const exoticVectors = [
      "192.168.1.1\nwhoami",
      "192.168.1.1\r\ncat /etc/passwd",
      "192.168.1.1\twhoami",
    ];

    for (const vector of exoticVectors) {
      const res = validateIp(vector);
      assert.strictEqual(res.valid, false, `Exotic vector should be invalid: "${vector}"`);

      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "admin",
        },
        body: JSON.stringify({ jail: "sshd", ip: vector }),
      });
      const routeRes = await fail2banUnbanPost(req);
      assert.strictEqual(routeRes.status, 400);
    }
  });

  // =========================================================================
  // PROBE SUITE 2: Missing Fields, Nulls, Type Juggling & Malformed Payloads
  // =========================================================================
  console.log("\n--- PROBE SUITE 2: Missing Fields, Nulls, Type Juggling & Malformed Payloads ---");

  await probe("2.1: Null or omitted ip and jail parameters return HTTP 400 without 500 crashes", async () => {
    const testCases = [
      { jail: null, ip: "192.168.1.1" },
      { jail: "sshd", ip: null },
      { jail: null, ip: null },
      { jail: "sshd" }, // omitted ip
      { ip: "192.168.1.1" }, // omitted jail
      {}, // omitted both
    ];

    for (const payload of testCases) {
      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "admin",
        },
        body: JSON.stringify(payload),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(
        res.status,
        400,
        `Expected 400 for payload ${JSON.stringify(payload)}, got ${res.status}`
      );
      const data = await res.json();
      assert.ok(data.error);
    }
  });

  await probe("2.2: Empty strings and whitespace-only values return HTTP 400", async () => {
    const emptyCases = [
      { jail: "", ip: "192.168.1.1" },
      { jail: "   ", ip: "192.168.1.1" },
      { jail: "sshd", ip: "" },
      { jail: "sshd", ip: "   " },
      { jail: "", ip: "" },
      { jail: "   ", ip: "   " },
    ];

    for (const payload of emptyCases) {
      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "admin",
        },
        body: JSON.stringify(payload),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(
        res.status,
        400,
        `Expected 400 for empty string payload, got ${res.status}`
      );
    }
  });

  await probe("2.3: Non-numeric strings in ports/IPs are safely rejected with HTTP 400", async () => {
    const malformedIps = [
      "192.168.1.1:8080", // port attached to IPv4
      "192.168.1.1:port", // alphanumeric port
      "192.168.1.abc",
      "foo.bar.baz.qux",
      "localhost",
      "server.local",
      "999.999.999.999", // out of range
      "256.0.0.1",
      "192.168.1.1.1", // 5 octets
      "192.168.1", // 3 octets
      "0.0.0.-1",
      "::gggg", // invalid hex IPv6
      "[192.168.1.1]", // bracketed IPv4
    ];

    for (const ipStr of malformedIps) {
      const check = validateIp(ipStr);
      assert.strictEqual(
        check.valid,
        false,
        `validateIp should reject malformed IP: "${ipStr}"`
      );

      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "admin",
        },
        body: JSON.stringify({ jail: "sshd", ip: ipStr }),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(
        res.status,
        400,
        `Route should return HTTP 400 for malformed IP "${ipStr}", got ${res.status}`
      );
    }
  });

  await probe("2.4: Type juggling (numbers, booleans, objects, arrays) in IP and jail", async () => {
    const typeJugglingCases = [
      { jail: 12345, ip: "192.168.1.1" },
      { jail: true, ip: "192.168.1.1" },
      { jail: {}, ip: "192.168.1.1" },
      { jail: ["sshd"], ip: "192.168.1.1" },
      { jail: "sshd", ip: 12345 },
      { jail: "sshd", ip: true },
      { jail: "sshd", ip: false },
      { jail: "sshd", ip: {} },
      { jail: "sshd", ip: ["192.168.1.1"] },
      { jail: "sshd", ip: { address: "192.168.1.1" } },
    ];

    for (const payload of typeJugglingCases) {
      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "admin",
        },
        body: JSON.stringify(payload),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(
        res.status,
        400,
        `Expected 400 for type juggling ${JSON.stringify(payload)}, got ${res.status}`
      );
    }
  });

  await probe("2.5: Malformed JSON and non-object bodies return HTTP 400 cleanly", async () => {
    const rawBodies = [
      "not-json{",
      "{ jail: 'sshd' }", // unquoted json
      JSON.stringify(["array", "payload"]),
      JSON.stringify(12345),
      JSON.stringify("string-only"),
      JSON.stringify(null),
    ];

    for (const body of rawBodies) {
      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "admin",
        },
        body,
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(
        res.status,
        400,
        `Expected 400 for body "${body}", got ${res.status}`
      );
    }
  });

  // =========================================================================
  // PROBE SUITE 3: Boundary Conditions & Non-Existent Unbans
  // =========================================================================
  console.log("\n--- PROBE SUITE 3: Boundary Conditions & Non-Existent Unbans ---");

  await probe("3.1: Unbanning an IP that is NOT banned returns 200 gracefully without 500 crash", async () => {
    resetMockFail2BanStore();

    // Verify initial store state
    const initialStatus = await getFail2BanStatus();
    const isAlreadyBanned = initialStatus.bannedList.some(
      (b) => b.ip === "203.0.113.199" && b.jail === "sshd"
    );
    assert.strictEqual(isAlreadyBanned, false);

    // Call service level
    const svcRes = await unbanIp({ jail: "sshd", ip: "203.0.113.199" });
    assert.strictEqual(svcRes.success, true);
    assert.ok(svcRes.message.includes("203.0.113.199"));

    // Call API route level
    const req = new Request("http://localhost:3000/api/fail2ban/unban", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-role": "admin",
      },
      body: JSON.stringify({ jail: "sshd", ip: "203.0.113.199" }),
    });
    const res = await fail2banUnbanPost(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.message.includes("203.0.113.199"));
  });

  await probe("3.2: Unbanning an IP from an unconfigured / non-existent jail returns 200 gracefully", async () => {
    const req = new Request("http://localhost:3000/api/fail2ban/unban", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-role": "admin",
      },
      body: JSON.stringify({ jail: "nonexistent-jail-custom", ip: "198.51.100.42" }),
    });
    const res = await fail2banUnbanPost(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
  });

  await probe("3.3: IPv6 address boundary unbans succeed without errors", async () => {
    const ipv6Addresses = [
      "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
      "2001:db8::1",
      "::1",
      "fe80::1",
    ];

    for (const ip6 of ipv6Addresses) {
      const check = validateIp(ip6);
      assert.strictEqual(check.valid, true, `Expected valid IPv6: ${ip6}`);

      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "admin",
        },
        body: JSON.stringify({ jail: "sshd", ip: ip6 }),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(res.status, 200, `Expected 200 for IPv6 unban: ${ip6}`);
      const data = await res.json();
      assert.strictEqual(data.success, true);
    }
  });

  await probe("3.4: Extreme length / ReDoS resilience probe (50,000 char strings)", async () => {
    // Malformed oversized strings (e.g. 50,000 chars with invalid characters)
    const longMalformedJail = "jail_" + "x".repeat(50000) + ";whoami";
    const longMalformedIp = "192.168.1." + "9".repeat(50000);

    const startJail = performance.now();
    const jailRes = validateJail(longMalformedJail);
    const durJail = performance.now() - startJail;
    assert.strictEqual(jailRes.valid, false, "Oversized malformed jail should be rejected");
    assert.ok(durJail < 200, `validateJail ReDoS check took ${durJail.toFixed(2)}ms (> 200ms)`);

    const startIp = performance.now();
    const ipRes = validateIp(longMalformedIp);
    const durIp = performance.now() - startIp;
    assert.strictEqual(ipRes.valid, false, "Oversized malformed IP should be rejected");
    assert.ok(durIp < 200, `validateIp ReDoS check took ${durIp.toFixed(2)}ms (> 200ms)`);
  });

  // =========================================================================
  // PROBE SUITE 4: High-Concurrency Unban Bursts & Mock Store Consistency
  // =========================================================================
  console.log("\n--- PROBE SUITE 4: High-Concurrency Unban Bursts & Mock Store Consistency ---");

  await probe("4.1: Burst of 50 concurrent requests targeting the same banned IP maintains consistency", async () => {
    resetMockFail2BanStore();

    // Verify initial presence
    const store = getMockStore();
    const initialMatch = store.bannedList.filter(
      (b) => b.ip === "192.168.1.100" && b.jail === "sshd"
    );
    assert.strictEqual(initialMatch.length, 1);

    // Fire 50 simultaneous unban calls
    const burstPromises = Array.from({ length: 50 }, (_, i) => {
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

    const results = await Promise.all(burstPromises);

    // All 50 must return HTTP 200
    for (const res of results) {
      assert.strictEqual(res.status, 200);
    }

    // Verify final state: 192.168.1.100 is completely removed, 10.0.0.55 remains intact
    const finalStatus = await getFail2BanStatus();
    const remainingTarget = finalStatus.bannedList.filter(
      (b) => b.ip === "192.168.1.100" && b.jail === "sshd"
    );
    assert.strictEqual(remainingTarget.length, 0, "Target IP should be completely unbanned");

    const preserved = finalStatus.bannedList.filter(
      (b) => b.ip === "10.0.0.55" && b.jail === "nginx-http-auth"
    );
    assert.strictEqual(preserved.length, 1, "Unrelated banned IP should remain preserved");
  });

  await probe("4.2: High-concurrency burst unbanning 25 distinct IPs from a 50-entry pool", async () => {
    resetMockFail2BanStore();
    const store = getMockStore();

    // Seed mock store with 50 distinct IPs
    const seededList = [];
    for (let i = 1; i <= 50; i++) {
      seededList.push({
        ip: `10.50.0.${i}`,
        jail: "sshd",
        banTime: new Date().toISOString(),
        bannedAt: new Date().toISOString(),
      });
    }
    store.bannedList = seededList;
    assert.strictEqual(store.bannedList.length, 50);

    // Fire 25 concurrent unbans for 10.50.0.1 through 10.50.0.25
    const unbanTargets = Array.from({ length: 25 }, (_, i) => `10.50.0.${i + 1}`);

    const burstPromises = unbanTargets.map((ip) => {
      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "admin",
        },
        body: JSON.stringify({ jail: "sshd", ip }),
      });
      return fail2banUnbanPost(req);
    });

    const start = performance.now();
    const responses = await Promise.all(burstPromises);
    const elapsed = performance.now() - start;

    console.log(`    Dispatched 25 concurrent distinct unban requests in ${elapsed.toFixed(1)}ms`);

    for (const res of responses) {
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
    }

    // Verify mock store state: exactly 25 remaining IPs (10.50.0.26 to 10.50.0.50)
    const updatedStatus = await getFail2BanStatus();
    assert.strictEqual(
      updatedStatus.bannedList.length,
      25,
      `Expected exactly 25 remaining banned IPs, got ${updatedStatus.bannedList.length}`
    );

    for (let i = 1; i <= 25; i++) {
      const exists = updatedStatus.bannedList.some((b) => b.ip === `10.50.0.${i}`);
      assert.strictEqual(exists, false, `10.50.0.${i} should have been unbanned`);
    }

    for (let i = 26; i <= 50; i++) {
      const exists = updatedStatus.bannedList.some((b) => b.ip === `10.50.0.${i}`);
      assert.strictEqual(exists, true, `10.50.0.${i} should still be banned`);
    }
  });

  await probe("4.3: Interleaved concurrent read (GET) and write (POST unban) load test", async () => {
    resetMockFail2BanStore();

    // Prepare 30 GET status requests and 20 POST unbans
    const getRequests = Array.from({ length: 30 }, () => {
      const req = new Request("http://localhost:3000/api/fail2ban", {
        method: "GET",
        headers: { "x-mock-role": "admin" },
      });
      return fail2banGet(req);
    });

    const postRequests = Array.from({ length: 20 }, (_, i) => {
      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "admin",
        },
        body: JSON.stringify({ jail: "sshd", ip: `198.51.100.${i + 1}` }),
      });
      return fail2banUnbanPost(req);
    });

    // Shuffle and execute all 50 concurrently
    const allRequests = [...getRequests, ...postRequests].sort(() => Math.random() - 0.5);

    const start = performance.now();
    const responses = await Promise.all(allRequests);
    const elapsed = performance.now() - start;

    console.log(`    Dispatched 50 interleaved GET/POST requests in ${elapsed.toFixed(1)}ms`);

    for (const res of responses) {
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
    }
  });

  await probe("4.4: High concurrency on 50 non-existent IP unbans completes without store corruption", async () => {
    resetMockFail2BanStore();
    const initialStatus = await getFail2BanStatus();

    const nonExistentRequests = Array.from({ length: 50 }, (_, i) => {
      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "admin",
        },
        body: JSON.stringify({ jail: "sshd", ip: `203.0.113.${i + 1}` }),
      });
      return fail2banUnbanPost(req);
    });

    const responses = await Promise.all(nonExistentRequests);
    for (const res of responses) {
      assert.strictEqual(res.status, 200);
    }

    // Verify existing store entries were not modified or corrupted
    const finalStatus = await getFail2BanStatus();
    assert.strictEqual(finalStatus.bannedList.length, initialStatus.bannedList.length);
    assert.deepStrictEqual(
      finalStatus.bannedList.map((b) => b.ip).sort(),
      initialStatus.bannedList.map((b) => b.ip).sort()
    );
  });

  // =========================================================================
  // PROBE SUITE 5: RBAC & Auth Guard Security Under Stress
  // =========================================================================
  console.log("\n--- PROBE SUITE 5: RBAC & Auth Guard Security Under Stress ---");

  await probe("5.1: Developer role is strictly 403 Forbidden even with malicious injection or edge payloads", async () => {
    const maliciousPayloads = [
      { jail: "sshd", ip: "192.168.1.100" },
      { jail: "sshd", ip: "192.168.1.1; whoami" },
      { jail: "sshd; rm -rf /", ip: "192.168.1.1" },
      { jail: null, ip: null },
      { jail: "sshd", ip: "203.0.113.199" },
    ];

    for (const payload of maliciousPayloads) {
      const req = new Request("http://localhost:3000/api/fail2ban/unban", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-role": "developer",
        },
        body: JSON.stringify(payload),
      });
      const res = await fail2banUnbanPost(req);
      assert.strictEqual(
        res.status,
        403,
        `Expected 403 Forbidden for Developer role on unban, got ${res.status}`
      );
      const data = await res.json();
      assert.ok(data.error.includes("Forbidden") || data.error.includes("Admin"));
    }
  });

  await probe("5.2: Anonymous / unauthenticated callers receive strictly HTTP 401", async () => {
    const unbanReq = new Request("http://localhost:3000/api/fail2ban/unban", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-role": "anonymous",
      },
      body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
    });
    const unbanRes = await fail2banUnbanPost(unbanReq);
    assert.strictEqual(unbanRes.status, 401);

    const getReq = new Request("http://localhost:3000/api/fail2ban", {
      method: "GET",
      headers: { "x-mock-role": "anonymous" },
    });
    const getRes = await fail2banGet(getReq);
    assert.strictEqual(getRes.status, 401);
  });

  await probe("5.3: Privilege escalation attempts (body role poisoning or header tampering) are blocked", async () => {
    // Attempt body role spoofing
    const poisonedBodyReq = new Request("http://localhost:3000/api/fail2ban/unban", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-role": "developer",
      },
      body: JSON.stringify({
        jail: "sshd",
        ip: "192.168.1.100",
        role: "admin",
        user: { role: "admin" },
      }),
    });
    const poisonedBodyRes = await fail2banUnbanPost(poisonedBodyReq);
    assert.strictEqual(poisonedBodyRes.status, 403);

    // Attempt legacy header privilege escalation
    const legacyHeaderReq = new Request("http://localhost:3000/api/fail2ban/unban", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-role": "developer",
        "x-user-role": "admin",
      },
      body: JSON.stringify({ jail: "sshd", ip: "192.168.1.100" }),
    });
    const legacyHeaderRes = await fail2banUnbanPost(legacyHeaderReq);
    assert.strictEqual(legacyHeaderRes.status, 403);
  });

  console.log("\n================================================================================");
  console.log(`  ALL ${totalProbes} CHALLENGER 1 ADVERSARIAL STRESS PROBES PASSED! (${passedProbes}/${totalProbes})`);
  console.log("  VERDICT: FULL COMPLIANCE & COMPLETE ADVERSARIAL IMMUNITY");
  console.log("================================================================================\n");
}

runChallengerSuite().catch((err) => {
  console.error("\n[FATAL] Adversarial challenge suite crashed:", err);
  process.exit(1);
});
