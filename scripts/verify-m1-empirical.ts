import { authConfig } from '../src/auth.config';
import { adminExists, createAdmin, getAdminByUsername, db } from '../src/lib/db';
import bcrypt from 'bcrypt';

const BASE_URL = 'http://localhost:3000';

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string, details?: any) {
  if (!condition) {
    const err = new Error(`Assertion failed: ${message}`);
    (err as any).details = details;
    throw err;
  }
}

async function runTest(suite: string, name: string, fn: () => Promise<void> | void) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      await res;
    }
    results.push({ suite, name, passed: true });
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    results.push({ suite, name, passed: false, error: err.message, details: err.details });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

async function runAll() {
  console.log('===============================================================');
  console.log('CHALLENGER 2: Milestone M1 Empirical Verification Harness');
  console.log('===============================================================');

  // -------------------------------------------------------------
  // SUITE 1: NextAuth Edge-Safe Authorized Logic (auth.config.ts)
  // -------------------------------------------------------------
  console.log('\n--- Suite 1: Edge-Safe Authorized Callback Unit Matrix ---');
  const authorized = authConfig.callbacks?.authorized;
  assert(typeof authorized === 'function', 'authorized callback must be a function');

  await runTest('Suite 1: Authorized Unit Matrix', '1.1: Unauthenticated request to / returns false', () => {
    const req = { nextUrl: new URL('http://localhost:3000/') } as any;
    const res = authorized!({ auth: null, request: req });
    assert(res === false, `Expected false, got ${res}`);
  });

  await runTest('Suite 1: Authorized Unit Matrix', '1.2: Authenticated request to / returns true', () => {
    const req = { nextUrl: new URL('http://localhost:3000/') } as any;
    const res = authorized!({ auth: { user: { name: 'admin' } } as any, request: req });
    assert(res === true, `Expected true, got ${res}`);
  });

  await runTest('Suite 1: Authorized Unit Matrix', '1.3: Unauthenticated request to /login returns true', () => {
    const req = { nextUrl: new URL('http://localhost:3000/login') } as any;
    const res = authorized!({ auth: null, request: req });
    assert(res === true, `Expected true, got ${res}`);
  });

  await runTest('Suite 1: Authorized Unit Matrix', '1.4: Authenticated request to /login returns redirect to /', () => {
    const req = { nextUrl: new URL('http://localhost:3000/login') } as any;
    const res = authorized!({ auth: { user: { name: 'admin' } } as any, request: req });
    assert(res instanceof Response, `Expected Response instance, got ${typeof res}`);
    const loc = (res as Response).headers.get('location');
    assert(loc?.endsWith('/') || loc === 'http://localhost:3000/', `Expected redirect to /, got ${loc}`);
  });

  await runTest('Suite 1: Authorized Unit Matrix', '1.5: Unauthenticated request to /setup returns true', () => {
    const req = { nextUrl: new URL('http://localhost:3000/setup') } as any;
    const res = authorized!({ auth: null, request: req });
    assert(res === true, `Expected true, got ${res}`);
  });

  await runTest('Suite 1: Authorized Unit Matrix', '1.6: Authenticated request to /setup returns true (proxy permits, page enforces redirect)', () => {
    const req = { nextUrl: new URL('http://localhost:3000/setup') } as any;
    const res = authorized!({ auth: { user: { name: 'admin' } } as any, request: req });
    assert(res === true, `Expected true, got ${res}`);
  });

  await runTest('Suite 1: Authorized Unit Matrix', '1.7: Unauthenticated request to /api/setup returns true (public API)', () => {
    const req = { nextUrl: new URL('http://localhost:3000/api/setup') } as any;
    const res = authorized!({ auth: null, request: req });
    assert(res === true, `Expected true, got ${res}`);
  });

  await runTest('Suite 1: Authorized Unit Matrix', '1.8: Unauthenticated request to /api/auth/signin returns true (public auth API)', () => {
    const req = { nextUrl: new URL('http://localhost:3000/api/auth/signin') } as any;
    const res = authorized!({ auth: null, request: req });
    assert(res === true, `Expected true, got ${res}`);
  });

  await runTest('Suite 1: Authorized Unit Matrix', '1.9: Unauthenticated request to protected API /api/pm2 returns false', () => {
    const req = { nextUrl: new URL('http://localhost:3000/api/pm2') } as any;
    const res = authorized!({ auth: null, request: req });
    assert(res === false, `Expected false for protected /api/pm2, got ${res}`);
  });

  await runTest('Suite 1: Authorized Unit Matrix', '1.10: Authenticated request to protected API /api/pm2 returns true', () => {
    const req = { nextUrl: new URL('http://localhost:3000/api/pm2') } as any;
    const res = authorized!({ auth: { user: { name: 'admin' } } as any, request: req });
    assert(res === true, `Expected true, got ${res}`);
  });

  await runTest('Suite 1: Authorized Unit Matrix', '1.11: Unauthenticated request to protected API /api/ports returns false', () => {
    const req = { nextUrl: new URL('http://localhost:3000/api/ports') } as any;
    const res = authorized!({ auth: null, request: req });
    assert(res === false, `Expected false for /api/ports, got ${res}`);
  });

  await runTest('Suite 1: Authorized Unit Matrix', '1.12: Unauthenticated request to /api/nginx/files returns false', () => {
    const req = { nextUrl: new URL('http://localhost:3000/api/nginx/files') } as any;
    const res = authorized!({ auth: null, request: req });
    assert(res === false, `Expected false for /api/nginx/files, got ${res}`);
  });

  await runTest('Suite 1: Authorized Unit Matrix', '1.13: Unauthenticated request to /api/terminal/execute returns false', () => {
    const req = { nextUrl: new URL('http://localhost:3000/api/terminal/execute') } as any;
    const res = authorized!({ auth: null, request: req });
    assert(res === false, `Expected false for /api/terminal/execute, got ${res}`);
  });

  // -------------------------------------------------------------
  // SUITE 2: Live HTTP Server - Fresh State (No Admin in DB)
  // -------------------------------------------------------------
  console.log('\n--- Suite 2: Live HTTP Fresh State (adminExists = false) ---');

  // Ensure DB has no users
  db.exec('DELETE FROM users');
  assert(!adminExists(), 'DB must be empty for fresh state tests');

  await runTest('Suite 2: Fresh State', '2.1: GET / unauthenticated redirects to /login', async () => {
    const res = await fetch(`${BASE_URL}/`, { redirect: 'manual' });
    assert(res.status === 307 || res.status === 302, `Expected 307/302, got ${res.status}`);
    const loc = res.headers.get('location') || '';
    assert(loc.includes('/login'), `Expected location to include /login, got ${loc}`);
  });

  await runTest('Suite 2: Fresh State', '2.2: GET /login when no admin exists redirects to /setup', async () => {
    const res = await fetch(`${BASE_URL}/login`, { redirect: 'manual' });
    assert(res.status === 307 || res.status === 302, `Expected 307/302, got ${res.status}`);
    const loc = res.headers.get('location') || '';
    assert(loc.includes('/setup'), `Expected location to include /setup, got ${loc}`);
  });

  await runTest('Suite 2: Fresh State', '2.3: Following redirects from GET / lands on /setup', async () => {
    const res = await fetch(`${BASE_URL}/`, { redirect: 'follow' });
    assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
    assert(res.url.includes('/setup'), `Expected final URL to include /setup, got ${res.url}`);
    const body = await res.text();
    assert(body.includes('Initial Server Setup') || body.includes('setup'), 'Expected Setup page content');
  });

  await runTest('Suite 2: Fresh State', '2.4: GET /setup when no admin exists returns 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/setup`, { redirect: 'manual' });
    assert(res.status === 200, `Expected 200 OK for /setup, got ${res.status}`);
    const body = await res.text();
    assert(body.includes('Initial Server Setup'), 'Expected "Initial Server Setup" in body');
  });

  await runTest('Suite 2: Fresh State', '2.5: Unauthenticated GET /api/pm2 redirects to /login', async () => {
    const res = await fetch(`${BASE_URL}/api/pm2`, { redirect: 'manual' });
    assert(res.status === 307 || res.status === 302, `Expected 307/302, got ${res.status}`);
    const loc = res.headers.get('location') || '';
    assert(loc.includes('/login'), `Expected redirect to /login, got ${loc}`);
  });

  // -------------------------------------------------------------
  // SUITE 3: POST /api/setup Validation & Creation
  // -------------------------------------------------------------
  console.log('\n--- Suite 3: POST /api/setup Validation & Admin Creation ---');

  await runTest('Suite 3: Setup API', '3.1: Rejects short username (< 3 chars)', async () => {
    const res = await fetch(`${BASE_URL}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ab', password: 'validpassword123' }),
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    const data = await res.json();
    assert(data.error?.includes('3 characters'), `Expected 3 chars error, got ${data.error}`);
  });

  await runTest('Suite 3: Setup API', '3.2: Rejects short password (< 6 chars)', async () => {
    const res = await fetch(`${BASE_URL}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'validuser', password: '123' }),
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    const data = await res.json();
    assert(data.error?.includes('6 characters'), `Expected 6 chars error, got ${data.error}`);
  });

  await runTest('Suite 3: Setup API', '3.3: Rejects malformed JSON body', async () => {
    const res = await fetch(`${BASE_URL}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ malformed json ',
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await runTest('Suite 3: Setup API', '3.4: Creates initial admin successfully with valid credentials', async () => {
    const res = await fetch(`${BASE_URL}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'superadmin', password: 'SuperPassword2026!' }),
    });
    assert(res.status === 201, `Expected 201 Created, got ${res.status}`);
    const data = await res.json();
    assert(data.success === true, 'Expected success === true');
    assert(adminExists() === true, 'adminExists() must return true after setup');

    const admin = getAdminByUsername('superadmin');
    assert(admin !== null, 'Admin user must exist in DB');
    assert(admin!.role === 'admin', 'Admin role must be admin');
    const match = await bcrypt.compare('SuperPassword2026!', admin!.passwordHash);
    assert(match, 'Password hash must match SuperPassword2026!');
  });

  await runTest('Suite 3: Setup API', '3.5: Second POST /api/setup is rejected with 400 (One-Time Setup)', async () => {
    const res = await fetch(`${BASE_URL}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'secondadmin', password: 'AnotherPassword2026!' }),
    });
    assert(res.status === 400, `Expected 400 Bad Request, got ${res.status}`);
    const data = await res.json();
    assert(data.error === 'Admin already exists', `Expected "Admin already exists", got ${data.error}`);
  });

  // -------------------------------------------------------------
  // SUITE 4: Live HTTP Server - Admin Exists State
  // -------------------------------------------------------------
  console.log('\n--- Suite 4: Live HTTP Admin Exists State (adminExists = true) ---');

  await runTest('Suite 4: Admin Exists State', '4.1: GET /setup when admin exists redirects to /login', async () => {
    const res = await fetch(`${BASE_URL}/setup`, { redirect: 'manual' });
    assert(res.status === 307 || res.status === 302, `Expected 307/302, got ${res.status}`);
    const loc = res.headers.get('location') || '';
    assert(loc.includes('/login'), `Expected location to include /login, got ${loc}`);
  });

  await runTest('Suite 4: Admin Exists State', '4.2: GET /login when admin exists returns 200 OK (LoginPage renders)', async () => {
    const res = await fetch(`${BASE_URL}/login`, { redirect: 'manual' });
    assert(res.status === 200, `Expected 200 OK for /login, got ${res.status}`);
    const body = await res.text();
    assert(body.includes('Sign In to PM2 Manager'), 'Expected "Sign In to PM2 Manager" in body');
  });

  await runTest('Suite 4: Admin Exists State', '4.3: GET / unauthenticated redirects to /login', async () => {
    const res = await fetch(`${BASE_URL}/`, { redirect: 'manual' });
    assert(res.status === 307 || res.status === 302, `Expected 307/302, got ${res.status}`);
    const loc = res.headers.get('location') || '';
    assert(loc.includes('/login'), `Expected location to include /login, got ${loc}`);
  });

  // -------------------------------------------------------------
  // SUITE 5: Authentication & Session Behavior
  // -------------------------------------------------------------
  console.log('\n--- Suite 5: Authentication & Session Behavior ---');

  const { TestClient } = await import('../tests/e2e/client');
  const client = new TestClient(BASE_URL);

  await runTest('Suite 5: Auth & Session', '5.1: Login with invalid password fails', async () => {
    const loginRes = await client.login('superadmin', 'wrong_password_here');
    assert(!loginRes.success, 'Login with wrong password must fail');
  });

  await runTest('Suite 5: Auth & Session', '5.2: Login with non-existent user fails', async () => {
    const loginRes = await client.login('nonexistent_user', 'some_password');
    assert(!loginRes.success, 'Login with non-existent user must fail');
  });

  await runTest('Suite 5: Auth & Session', '5.3: Login with correct credentials succeeds and obtains session cookie', async () => {
    const loginRes = await client.login('superadmin', 'SuperPassword2026!');
    assert(loginRes.success, `Login must succeed, got error: ${loginRes.error}`);
    assert(client.getCookieHeader().includes('session-token'), 'Cookie header must contain session-token');
  });

  await runTest('Suite 5: Auth & Session', '5.4: Authenticated GET / returns 200 OK and renders Dashboard', async () => {
    const res = await client.fetch('/', { redirect: 'manual' });
    assert(res.status === 200, `Expected 200 OK for authenticated /, got ${res.status}`);
    const body = await res.text();
    assert(body.includes('PM2 Management Dashboard'), 'Expected "PM2 Management Dashboard" in body');
    assert(body.includes('superadmin') || body.includes('Admin:'), 'Expected admin username in body');
    assert(body.includes('Sign Out'), 'Expected "Sign Out" button in body');
  });

  await runTest('Suite 5: Auth & Session', '5.5: Authenticated GET /login redirects to /', async () => {
    const res = await client.fetch('/login', { redirect: 'manual' });
    assert(res.status === 307 || res.status === 302, `Expected 307/302 for authenticated /login, got ${res.status}`);
    const loc = res.headers.get('location') || '';
    assert(loc.endsWith('/') || loc === `${BASE_URL}/`, `Expected redirect to /, got ${loc}`);
  });

  await runTest('Suite 5: Auth & Session', '5.6: Case-insensitive username login works (collating NOCASE)', async () => {
    const caseClient = new TestClient(BASE_URL);
    const loginRes = await caseClient.login('SUPERADMIN', 'SuperPassword2026!');
    assert(loginRes.success, `Expected case-insensitive login to succeed, got: ${loginRes.error}`);
  });

  // -------------------------------------------------------------
  // SUITE 6: Stress & Security Testing
  // -------------------------------------------------------------
  console.log('\n--- Suite 6: Stress & Security Testing ---');

  await runTest('Suite 6: Stress Testing', '6.1: Concurrent POST /api/setup race condition', async () => {
    db.exec('DELETE FROM users');
    assert(!adminExists(), 'DB must be empty for concurrency race test');

    const promises = Array.from({ length: 10 }).map((_, i) =>
      fetch(`${BASE_URL}/api/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: `admin_${i}`, password: `Password${i}_123!` }),
      })
    );

    const responses = await Promise.all(promises);
    const statuses = responses.map((r) => r.status);
    const successCount = statuses.filter((s) => s === 201).length;
    const clientErrorCount = statuses.filter((s) => s === 400).length;

    console.log(`    Concurrency results: 201 count = ${successCount}, 400 count = ${clientErrorCount}`);

    const totalAdmins = (db.prepare('SELECT count(*) as count FROM users').get() as any).count;
    console.log(`    Total admins in database after race: ${totalAdmins}`);

    assert(totalAdmins === 1, `Total admins in database MUST be 1, got ${totalAdmins}`);
    assert(successCount === 1, `Exactly 1 request must succeed with 201, got ${successCount}`);
    assert(clientErrorCount === 9, `All other 9 requests must be rejected with 400, got ${clientErrorCount}`);
  });

  await runTest('Suite 6: Stress Testing', '6.2: Tampered/forged session cookie is rejected', async () => {
    const tamperedClient = new TestClient(BASE_URL);
    tamperedClient.setCookie('authjs.session-token', 'forged_invalid_jwt_token_pm2');
    const res = await tamperedClient.fetch('/', { redirect: 'manual' });
    assert(res.status === 307 || res.status === 302, `Expected redirect for forged session, got ${res.status}`);
    const loc = res.headers.get('location') || '';
    assert(loc.includes('/login'), `Expected redirect to /login, got ${loc}`);
  });

  // Final cleanup: restore clean state with 0 users
  db.exec('DELETE FROM users');
  console.log('\nDatabase cleaned up to fresh install baseline state (0 users).');

  // Summary
  console.log('\n===============================================================');
  console.log('TEST SUMMARY:');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
  console.log('===============================================================');

  if (failed > 0) {
    console.error('VERIFICATION FAILED!');
    process.exit(1);
  } else {
    console.log('ALL EMPIRICAL TESTS PASSED SUCCESSFULLY!');
  }
}

runAll().catch((e) => {
  console.error('Fatal error during test run:', e);
  process.exit(1);
});
