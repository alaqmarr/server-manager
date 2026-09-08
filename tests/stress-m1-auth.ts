import { db, adminExists, createAdmin, getAdminByUsername } from '../src/lib/db';
import { POST } from '../src/app/api/setup/route';
import { authConfig } from '../src/auth.config';
import bcrypt from 'bcrypt';

interface TestResult {
  category: string;
  name: string;
  passed: boolean;
  error?: string;
  details?: unknown;
}

const results: TestResult[] = [];

function record(category: string, name: string, passed: boolean, error?: string, details?: unknown) {
  results.push({ category, name, passed, error, details });
  const status = passed ? '✔ PASS' : '✖ FAIL';
  console.log(`[${status}] [${category}] ${name}`);
  if (!passed && error) {
    console.error(`       Error: ${error}`);
    if (details) console.error(`       Details:`, JSON.stringify(details, null, 2));
  }
}

function clearUsers() {
  db.exec('DELETE FROM users');
}

async function runTests() {
  console.log('===============================================================');
  console.log('       EMPIRICAL CHALLENGER: M1 AUTH & SETUP STRESS TEST       ');
  console.log('===============================================================\n');

  // Save initial db state
  const initialUsers = db.prepare('SELECT * FROM users').all();
  clearUsers();

  try {
    // =========================================================================
    // CATEGORY 1: Duplicate Admin Creation & Concurrency
    // =========================================================================
    console.log('--- Testing Category 1: Duplicate Admin Creation ---');

    // 1.1: Initial state has no admin
    record('Duplicate Admin', '1.1: Fresh database reports adminExists() === false', adminExists() === false);

    // 1.2: Initial admin creation via POST /api/setup succeeds
    const req1 = new Request('http://localhost:3000/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'InitialAdmin', password: 'Password123!' }),
    });
    const res1 = await POST(req1);
    const data1 = await res1.json();
    record(
      'Duplicate Admin',
      '1.2: Initial setup POST creates admin (HTTP 201)',
      res1.status === 201 && data1.success === true && adminExists() === true,
      `Status: ${res1.status}, data: ${JSON.stringify(data1)}`
    );

    // 1.3: Second POST /api/setup with SAME username is rejected (HTTP 400)
    const req2Same = new Request('http://localhost:3000/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'InitialAdmin', password: 'Password123!' }),
    });
    const res2Same = await POST(req2Same);
    const data2Same = await res2Same.json();
    record(
      'Duplicate Admin',
      '1.3: Second setup attempt with same username returns HTTP 400',
      res2Same.status === 400 && data2Same.error === 'Admin already exists',
      `Status: ${res2Same.status}, error: ${data2Same.error}`
    );

    // 1.4: Second POST /api/setup with DIFFERENT username is rejected (HTTP 400)
    const req2Diff = new Request('http://localhost:3000/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'SecondAdmin', password: 'AnotherPassword123!' }),
    });
    const res2Diff = await POST(req2Diff);
    const data2Diff = await res2Diff.json();
    record(
      'Duplicate Admin',
      '1.4: Second setup attempt with different username returns HTTP 400 (single admin enforced sequentially)',
      res2Diff.status === 400 && data2Diff.error === 'Admin already exists',
      `Status: ${res2Diff.status}, error: ${data2Diff.error}`
    );

    // 1.5: Direct createAdmin call with SAME username fails in SQLite (NOCASE UNIQUE)
    const hash = await bcrypt.hash('password123', 10);
    const createSameResult = createAdmin('InitialAdmin', hash);
    record(
      'Duplicate Admin',
      '1.5: createAdmin() with duplicate username returns false (SQLite UNIQUE constraint)',
      createSameResult === false
    );

    // 1.6: Direct createAdmin call with DIFFERENT username when admin already exists
    const usersCountBefore = (db.prepare('SELECT count(*) as count FROM users').get() as { count: number }).count;
    const createDiffResult = createAdmin('BypassAdmin', hash);
    const usersCountAfter = (db.prepare('SELECT count(*) as count FROM users').get() as { count: number }).count;
    // Note: If createAdmin succeeds, the DB layer does NOT enforce single admin!
    record(
      'Duplicate Admin',
      '1.6: DB layer createAdmin() rejects second admin creation when admin already exists',
      createDiffResult === false && usersCountAfter === usersCountBefore,
      `createAdmin allowed bypass: returned ${createDiffResult}, user count went from ${usersCountBefore} to ${usersCountAfter}`,
      { usersCountBefore, usersCountAfter, createDiffResult }
    );

    // 1.7: Concurrency / Race Condition on POST /api/setup
    // Reset database to test concurrency race window
    clearUsers();
    record('Duplicate Admin', '1.7.0: Database reset for concurrency race test', adminExists() === false);

    // Send 5 simultaneous POST /api/setup requests with DIFFERENT usernames
    const concurrentRequests = [
      { username: 'RaceUser1', password: 'PasswordRace1!' },
      { username: 'RaceUser2', password: 'PasswordRace2!' },
      { username: 'RaceUser3', password: 'PasswordRace3!' },
      { username: 'RaceUser4', password: 'PasswordRace4!' },
      { username: 'RaceUser5', password: 'PasswordRace5!' },
    ];

    const concurrentResponses = await Promise.all(
      concurrentRequests.map(async (body) => {
        const req = new Request('http://localhost:3000/api/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const res = await POST(req);
        const data = await res.json();
        return { status: res.status, data, username: body.username };
      })
    );

    const successfulSetups = concurrentResponses.filter((r) => r.status === 201);
    const rejectedSetups = concurrentResponses.filter((r) => r.status === 400);
    const totalUsersInDb = (db.prepare('SELECT count(*) as count FROM users').get() as { count: number }).count;

    record(
      'Duplicate Admin',
      '1.7: Concurrency race condition test on POST /api/setup (5 parallel requests)',
      successfulSetups.length === 1 && totalUsersInDb === 1,
      `TOCTOU race condition: Expected exactly 1 successful setup, got ${successfulSetups.length} successes. Total users in DB: ${totalUsersInDb}`,
      { successfulSetups, rejectedSetups, totalUsersInDb }
    );

    // =========================================================================
    // CATEGORY 2: Empty or Short Payloads
    // =========================================================================
    console.log('\n--- Testing Category 2: Empty or Short Payloads ---');
    clearUsers();

    const boundaryCases = [
      { name: '2.1: Empty username ("")', body: { username: '', password: 'validPassword123' }, expectStatus: 400 },
      { name: '2.2: Whitespace-only username ("   ")', body: { username: '   ', password: 'validPassword123' }, expectStatus: 400 },
      { name: '2.3: 1-character username ("a")', body: { username: 'a', password: 'validPassword123' }, expectStatus: 400 },
      { name: '2.4: 2-character username ("ab")', body: { username: 'ab', password: 'validPassword123' }, expectStatus: 400 },
      { name: '2.5: Whitespace-padded 2-char username ("  ab  ")', body: { username: '  ab  ', password: 'validPassword123' }, expectStatus: 400 },
      { name: '2.6: Empty password ("")', body: { username: 'validUser', password: '' }, expectStatus: 400 },
      { name: '2.7: 1-character password ("1")', body: { username: 'validUser', password: '1' }, expectStatus: 400 },
      { name: '2.8: 5-character password ("12345")', body: { username: 'validUser', password: '12345' }, expectStatus: 400 },
      { name: '2.9: Missing username property', body: { password: 'validPassword123' }, expectStatus: 400 },
      { name: '2.10: Missing password property', body: { username: 'validUser' }, expectStatus: 400 },
      { name: '2.11: Empty JSON payload ({})', body: {}, expectStatus: 400 },
      { name: '2.12: Numeric username ({ username: 12345 })', body: { username: 12345, password: 'validPassword123' }, expectStatus: 400 },
      { name: '2.13: Numeric password ({ password: 123456 })', body: { username: 'validUser', password: 123456 }, expectStatus: 400 },
      { name: '2.14: Null values ({ username: null, password: null })', body: { username: null, password: null }, expectStatus: 400 },
      { name: '2.15: Array values ({ username: ["abc"], password: ["password123"] })', body: { username: ['abc'], password: ['password123'] }, expectStatus: 400 },
      { name: '2.16: Object values ({ username: {}, password: {} })', body: { username: {}, password: {} }, expectStatus: 400 },
      { name: '2.17: Boolean values ({ username: true, password: false })', body: { username: true, password: false }, expectStatus: 400 },
    ];

    for (const testCase of boundaryCases) {
      const req = new Request('http://localhost:3000/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testCase.body),
      });
      const res = await POST(req);
      const data = await res.json();
      record(
        'Boundary Payloads',
        testCase.name,
        res.status === testCase.expectStatus && typeof data.error === 'string',
        `Expected status ${testCase.expectStatus}, got ${res.status}. Data: ${JSON.stringify(data)}`
      );
    }

    // 2.18: Malformed JSON body
    const reqMalformed = new Request('http://localhost:3000/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ broken json: true ',
    });
    const resMalformed = await POST(reqMalformed);
    const dataMalformed = await resMalformed.json();
    record(
      'Boundary Payloads',
      '2.18: Malformed JSON body is caught and rejected with HTTP 400',
      resMalformed.status === 400 && dataMalformed.error === 'Invalid JSON body',
      `Status: ${resMalformed.status}, error: ${dataMalformed.error}`
    );

    // 2.19: Minimum valid boundary test: exactly 3-char username, exactly 6-char password
    const reqMinValid = new Request('http://localhost:3000/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'abc', password: '123456' }),
    });
    const resMinValid = await POST(reqMinValid);
    const dataMinValid = await resMinValid.json();
    record(
      'Boundary Payloads',
      '2.19: Boundary valid credentials (3-char username "abc", 6-char password "123456") succeed (HTTP 201)',
      resMinValid.status === 201 && dataMinValid.success === true,
      `Status: ${resMinValid.status}, data: ${JSON.stringify(dataMinValid)}`
    );

    // =========================================================================
    // CATEGORY 3: Case Insensitivity of Usernames in SQLite
    // =========================================================================
    console.log('\n--- Testing Category 3: Case Insensitivity of Usernames in SQLite ---');
    clearUsers();

    // 3.1: Seed initial user "SuperAdmin"
    const validHash = await bcrypt.hash('MySecretPassword123', 10);
    const seeded = createAdmin('SuperAdmin', validHash);
    record('Case Insensitivity', '3.1: Seed user "SuperAdmin" into database', seeded === true);

    // 3.2: Query with exact casing "SuperAdmin"
    const userExact = getAdminByUsername('SuperAdmin');
    record('Case Insensitivity', '3.2: getAdminByUsername("SuperAdmin") matches', userExact !== null && userExact.username === 'SuperAdmin');

    // 3.3: Query with lowercase "superadmin"
    const userLower = getAdminByUsername('superadmin');
    record('Case Insensitivity', '3.3: getAdminByUsername("superadmin") matches', userLower !== null && userLower.id === userExact?.id);

    // 3.4: Query with uppercase "SUPERADMIN"
    const userUpper = getAdminByUsername('SUPERADMIN');
    record('Case Insensitivity', '3.4: getAdminByUsername("SUPERADMIN") matches', userUpper !== null && userUpper.id === userExact?.id);

    // 3.5: Query with mixed case "sUpErAdMiN"
    const userMixed = getAdminByUsername('sUpErAdMiN');
    record('Case Insensitivity', '3.5: getAdminByUsername("sUpErAdMiN") matches', userMixed !== null && userMixed.id === userExact?.id);

    // 3.6: Query with leading and trailing whitespace "  SuperAdmin  "
    const userWhitespace = getAdminByUsername('  superadmin  ');
    record('Case Insensitivity', '3.6: getAdminByUsername("  superadmin  ") trimmed match', userWhitespace !== null && userWhitespace.id === userExact?.id);

    // 3.7: SQLite NOCASE UNIQUE constraint prevents inserting lowercase duplicate
    const duplicateLowerResult = createAdmin('superadmin', validHash);
    record(
      'Case Insensitivity',
      '3.7: createAdmin("superadmin") is rejected by SQLite UNIQUE COLLATE NOCASE',
      duplicateLowerResult === false
    );

    // 3.8: SQLite NOCASE UNIQUE constraint prevents inserting uppercase duplicate
    const duplicateUpperResult = createAdmin('SUPERADMIN', validHash);
    record(
      'Case Insensitivity',
      '3.8: createAdmin("SUPERADMIN") is rejected by SQLite UNIQUE COLLATE NOCASE',
      duplicateUpperResult === false
    );

    // 3.9: SQL Injection attempt in username parameter
    const sqlInjectionUser = getAdminByUsername("' OR '1'='1");
    record(
      'Case Insensitivity',
      '3.9: SQL injection parameter safely handled without returning record',
      sqlInjectionUser === null
    );

    // =========================================================================
    // CATEGORY 4: Bcrypt Hash Validity
    // =========================================================================
    console.log('\n--- Testing Category 4: Bcrypt Hash Validity ---');

    // 4.1: Inspect stored hash format
    const storedUser = getAdminByUsername('SuperAdmin');
    const storedHash = storedUser?.passwordHash || '';
    const bcryptRegex = /^\$2[abxy]\$10\$[./A-Za-z0-9]{53}$/;
    record(
      'Bcrypt Validity',
      '4.1: Hash conforms to standard 60-char modular format ($2a$10$ / $2b$10$...)',
      bcryptRegex.test(storedHash) && storedHash.length === 60,
      `Hash: ${storedHash}`
    );

    // 4.2: Extract cost factor (rounds)
    const costFactor = storedHash.split('$')[2];
    record(
      'Bcrypt Validity',
      '4.2: Bcrypt cost factor is exactly 10 rounds',
      costFactor === '10',
      `Cost factor: ${costFactor}`
    );

    // 4.3: Verify correct password against hash
    const matchCorrect = await bcrypt.compare('MySecretPassword123', storedHash);
    record('Bcrypt Validity', '4.3: bcrypt.compare() succeeds with correct password', matchCorrect === true);

    // 4.4: Verify wrong password against hash
    const matchWrong = await bcrypt.compare('WrongPassword456', storedHash);
    record('Bcrypt Validity', '4.4: bcrypt.compare() rejects wrong password', matchWrong === false);

    // 4.5: Verify empty password against hash
    const matchEmpty = await bcrypt.compare('', storedHash);
    record('Bcrypt Validity', '4.5: bcrypt.compare() rejects empty password', matchEmpty === false);

    // 4.6: Verify password with trailing whitespace difference
    const matchSpace = await bcrypt.compare('MySecretPassword123 ', storedHash);
    record('Bcrypt Validity', '4.6: bcrypt.compare() rejects trailing whitespace difference', matchSpace === false);

    // 4.7: Salt uniqueness: Hashing same password twice yields different hashes
    const hashA = await bcrypt.hash('TestPassword123', 10);
    const hashB = await bcrypt.hash('TestPassword123', 10);
    record(
      'Bcrypt Validity',
      '4.7: Unique salt generation (hashing same plaintext twice yields distinct hashes)',
      hashA !== hashB && (await bcrypt.compare('TestPassword123', hashA)) && (await bcrypt.compare('TestPassword123', hashB))
    );

    // 4.8: Passwords with special characters, unicode, and emojis
    const unicodePassword = 'P@sswørd!_🚀_日本語';
    const unicodeHash = await bcrypt.hash(unicodePassword, 10);
    const unicodeMatch = await bcrypt.compare(unicodePassword, unicodeHash);
    record('Bcrypt Validity', '4.8: Unicode and emoji password hashing and comparison', unicodeMatch === true);

    // 4.9: Long password (>72 bytes) truncation behavior
    const longPw1 = 'A'.repeat(72) + 'XYZ123';
    const longPw2 = 'A'.repeat(72) + 'DIFFERENT';
    const longHash = await bcrypt.hash(longPw1, 10);
    const longMatch1 = await bcrypt.compare(longPw1, longHash);
    const longMatch2 = await bcrypt.compare(longPw2, longHash);
    record(
      'Bcrypt Validity',
      '4.9: Bcrypt 72-byte boundary behavior verified',
      longMatch1 === true,
      undefined,
      { matchesSelf: longMatch1, matchesDifferingTail: longMatch2 }
    );

    // =========================================================================
    // CATEGORY 5: NextAuth / Proxy Route Authorization Rules
    // =========================================================================
    console.log('\n--- Testing Category 5: NextAuth / Proxy Authorization Callback ---');

    const authCallback = authConfig.callbacks?.authorized;
    if (!authCallback) {
      record('Route Protection', '5.0: authorized callback defined in authConfig', false);
    } else {
      // 5.1: Unauthenticated request to / (dashboard) is denied
      const resUnauthRoot = authCallback({
        auth: null,
        request: { nextUrl: new URL('http://localhost:3000/') as any } as any,
      });
      record('Route Protection', '5.1: Unauthenticated access to / is denied (returns false)', resUnauthRoot === false);

      // 5.2: Unauthenticated request to /api/pm2 is denied
      const resUnauthPm2 = authCallback({
        auth: null,
        request: { nextUrl: new URL('http://localhost:3000/api/pm2') as any } as any,
      });
      record('Route Protection', '5.2: Unauthenticated access to /api/pm2 is denied (returns false)', resUnauthPm2 === false);

      // 5.3: Unauthenticated request to /login is allowed
      const resUnauthLogin = authCallback({
        auth: null,
        request: { nextUrl: new URL('http://localhost:3000/login') as any } as any,
      });
      record('Route Protection', '5.3: Unauthenticated access to /login is permitted (returns true)', resUnauthLogin === true);

      // 5.4: Unauthenticated request to /setup is allowed
      const resUnauthSetup = authCallback({
        auth: null,
        request: { nextUrl: new URL('http://localhost:3000/setup') as any } as any,
      });
      record('Route Protection', '5.4: Unauthenticated access to /setup is permitted (returns true)', resUnauthSetup === true);

      // 5.5: Public API /api/setup is allowed without session
      const resUnauthApiSetup = authCallback({
        auth: null,
        request: { nextUrl: new URL('http://localhost:3000/api/setup') as any } as any,
      });
      record('Route Protection', '5.5: Access to public /api/setup is permitted (returns true)', resUnauthApiSetup === true);

      // 5.6: Authenticated request to / is allowed
      const resAuthRoot = authCallback({
        auth: { user: { name: 'admin' }, expires: '' },
        request: { nextUrl: new URL('http://localhost:3000/') as any } as any,
      });
      record('Route Protection', '5.6: Authenticated access to / is permitted (returns true)', resAuthRoot === true);

      // 5.7: Authenticated request to /login redirects away (status 302/307)
      const resAuthLogin = authCallback({
        auth: { user: { name: 'admin' }, expires: '' },
        request: { nextUrl: new URL('http://localhost:3000/login') as any } as any,
      });
      const isRedirect =
        resAuthLogin instanceof Response &&
        (resAuthLogin.status === 302 || resAuthLogin.status === 307);
      record(
        'Route Protection',
        '5.7: Authenticated access to /login redirects to / (HTTP 302/307)',
        isRedirect,
        `Expected redirect Response (302/307), got: ${resAuthLogin instanceof Response ? resAuthLogin.status : typeof resAuthLogin}`,
        { redirectStatus: resAuthLogin instanceof Response ? resAuthLogin.status : typeof resAuthLogin }
      );
    }

  } finally {
    // Restore initial DB state
    clearUsers();
    for (const u of initialUsers as any[]) {
      createAdmin(u.username, u.passwordHash);
    }
    console.log('\n[INFO] Restored database to original state.');
  }

  // Summary
  console.log('\n===============================================================');
  console.log('                      TEST RUN SUMMARY                         ');
  console.log('===============================================================');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total Tests : ${total}`);
  console.log(`Passed      : ${passed}`);
  console.log(`Failed      : ${failed}`);
  console.log('===============================================================');

  if (failed > 0) {
    console.log('\nFAILED TESTS:');
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`- [${r.category}] ${r.name}: ${r.error}`);
    }
  } else {
    console.log('\nALL EMPIRICAL TESTS PASSED SUCCESSFULLY!');
  }
}

runTests().catch((err) => {
  console.error('Unhandled test harness error:', err);
  process.exit(1);
});
