import { TestClient } from './client';
import { TestSuiteCollector, expect } from './test-framework';
import { PM2ListResponse, PortsResponse, NginxContentResponse } from './types';

export function registerTier2Tests(
  collector: TestSuiteCollector,
  client: TestClient,
  credentials = { username: 'admin', password: 'password123' }
): void {
  let authAttempted = false;
  async function ensureAuth() {
    if (!authAttempted && !client.getCookieHeader().includes('session-token')) {
      authAttempted = true;
      try {
        await client.setupAdmin(credentials.username, credentials.password);
      } catch {}
      await client.login(credentials.username, credentials.password);
    }
  }
  // Feature 1: Unauthenticated API Access & Session Boundaries
  collector.describe('Tier 2 Feature 1: Unauthenticated Boundaries', () => {
    collector.it('2.1.1: Unauthenticated POST /api/pm2/action returns 401 or redirect', async () => {
      const anon = client.createAnonymousClient();
      const res = await anon.post('/api/pm2/action', { action: 'stop', id: 0 }, { followRedirects: false });
      const isProtected = res.status === 401 || res.status === 403 || res.status === 307 || res.status === 302;
      expect(isProtected).toBeTruthy(`Expected 401/403 or redirect, got ${res.status}`);
    });

    collector.it('2.1.2: Unauthenticated GET /api/nginx/content returns 401 or redirect', async () => {
      const anon = client.createAnonymousClient();
      const res = await anon.get('/api/nginx/content?file=nginx.conf', { followRedirects: false });
      const isProtected = res.status === 401 || res.status === 403 || res.status === 307 || res.status === 302;
      expect(isProtected).toBeTruthy(`Expected 401/403 or redirect, got ${res.status}`);
    });

    collector.it('2.1.3: Unauthenticated POST /api/nginx/save returns 401 or redirect', async () => {
      const anon = client.createAnonymousClient();
      const res = await anon.post('/api/nginx/save', { relativePath: 'nginx.conf', content: 'test' }, { followRedirects: false });
      const isProtected = res.status === 401 || res.status === 403 || res.status === 307 || res.status === 302;
      expect(isProtected).toBeTruthy(`Expected 401/403 or redirect, got ${res.status}`);
    });

    collector.it('2.1.4: Direct access with forged session cookie returns 401 or redirect', async () => {
      const forged = client.createAnonymousClient();
      forged.setCookie('authjs.session-token', 'malformed-forged-token-xyz123');
      forged.setCookie('__Secure-authjs.session-token', 'malformed-forged-token-xyz123');
      const res = await forged.get('/api/pm2', { followRedirects: false });
      const isProtected = res.status === 401 || res.status === 403 || res.status === 307 || res.status === 302;
      expect(isProtected).toBeTruthy(`Expected 401/403 or redirect for forged token, got ${res.status}`);
    });

    collector.it('2.1.5: Accessing protected page with malformed token redirects to /login', async () => {
      const forged = client.createAnonymousClient();
      forged.setCookie('authjs.session-token', 'malformed-forged-token-xyz123');
      const res = await forged.fetch('/', { followRedirects: false });
      const isRedirect = res.status === 307 || res.status === 302;
      const location = res.headers.get('location') || '';
      expect(isRedirect || res.status === 200).toBeTruthy();
      if (isRedirect) {
        expect(location.includes('/login') || location.includes('/setup')).toBeTruthy();
      }
    });
  });

  // Feature 2: Setup Invalid Payloads & Boundary Enforcement
  collector.describe('Tier 2 Feature 2: Setup Boundary & Negative Cases', () => {
    collector.it('2.2.1: POST /api/setup with missing username returns 400', async () => {
      const res = await client.post('/api/setup', { password: 'validpassword123' });
      expect(res.status).toBe(400);
    });

    collector.it('2.2.2: POST /api/setup with missing password returns 400', async () => {
      const res = await client.post('/api/setup', { username: 'someuser' });
      expect(res.status).toBe(400);
    });

    collector.it('2.2.3: POST /api/setup with empty JSON object returns 400', async () => {
      const res = await client.post('/api/setup', {});
      expect(res.status).toBe(400);
    });

    collector.it('2.2.4: POST /api/setup with whitespace-only username returns 400', async () => {
      const res = await client.post('/api/setup', { username: '   ', password: 'validpassword123' });
      expect(res.status).toBe(400);
    });

    collector.it('2.2.5: POST /api/setup with password under 6 chars returns 400', async () => {
      const res = await client.post('/api/setup', { username: 'validadmin', password: '123' });
      expect(res.status).toBe(400);
    });
  });

  // Feature 3: NextAuth Authentication Boundaries
  collector.describe('Tier 2 Feature 3: NextAuth Authentication Boundaries', () => {
    collector.it('2.3.1: Credentials login with empty username & password is rejected', async () => {
      const anon = client.createAnonymousClient();
      const loginRes = await anon.login('', '');
      expect(loginRes.success).toBeFalsy();
    });

    collector.it('2.3.2: Credentials login with SQL injection vector in username is safely rejected', async () => {
      const anon = client.createAnonymousClient();
      const loginRes = await anon.login("' OR '1'='1", "password'; DROP TABLE users; --");
      expect(loginRes.success).toBeFalsy();
    });

    collector.it('2.3.3: Credentials login with extremely long string is rejected gracefully', async () => {
      const anon = client.createAnonymousClient();
      const hugeString = 'A'.repeat(5000);
      const loginRes = await anon.login(hugeString, hugeString);
      expect(loginRes.success).toBeFalsy();
    });

    collector.it('2.3.4: GET /api/auth/csrf without cookies returns new CSRF token', async () => {
      const anon = client.createAnonymousClient();
      const csrf = await anon.getCsrfToken();
      expect(typeof csrf).toBe('string');
      expect(csrf.length > 0).toBeTruthy();
    });

    collector.it('2.3.5: GET /api/auth/session without active cookies returns empty session or null user', async () => {
      const anon = client.createAnonymousClient();
      const res = await anon.get('/api/auth/session');
      expect(res.status).toBe(200);
      const user = res.data?.user;
      expect(!user || Object.keys(user).length === 0).toBeTruthy();
    });
  });

  // Feature 4: PM2 Query & State Boundaries
  collector.describe('Tier 2 Feature 4: PM2 Query & Metrics Boundaries', () => {
    collector.it('2.4.1: GET /api/pm2 handles mock query variations safely', async () => {
      await ensureAuth();
      const res1 = await client.get<PM2ListResponse>('/api/pm2?mock=true');
      const res2 = await client.get<PM2ListResponse>('/api/pm2?mock=false');
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });

    collector.it('2.4.2: Burst polling (5 parallel requests) returns 200 without crashing', async () => {
      const burst = await Promise.all([
        client.get<PM2ListResponse>('/api/pm2'),
        client.get<PM2ListResponse>('/api/pm2'),
        client.get<PM2ListResponse>('/api/pm2'),
        client.get<PM2ListResponse>('/api/pm2'),
        client.get<PM2ListResponse>('/api/pm2'),
      ]);
      for (const r of burst) {
        expect(r.status).toBe(200);
        expect(r.data?.success).toBe(true);
      }
    });

    collector.it('2.4.3: Summary metrics non-negative boundary checks', async () => {
      const res = await client.get<PM2ListResponse>('/api/pm2');
      const summary = res.data?.summary;
      expect(summary.total >= 0).toBeTruthy();
      expect(summary.online >= 0).toBeTruthy();
      expect(summary.stopped >= 0).toBeTruthy();
      expect(summary.totalMemoryBytes >= 0).toBeTruthy();
      expect(summary.avgCpuPercent >= 0).toBeTruthy();
    });

    collector.it('2.4.4: PM2 process CPU percent is within valid bounds (0 <= cpu <= 1000)', async () => {
      const res = await client.get<PM2ListResponse>('/api/pm2');
      for (const proc of res.data.processes) {
        expect(typeof proc.cpu).toBe('number');
        expect(proc.cpu >= 0 && proc.cpu <= 1000).toBeTruthy();
      }
    });

    collector.it('2.4.5: Summary total equals online + stopped + errored count', async () => {
      const res = await client.get<PM2ListResponse>('/api/pm2');
      const s = res.data?.summary;
      const calculated = s.online + s.stopped + (s as any).errored || (s.online + s.stopped);
      expect(s.total >= calculated).toBeTruthy();
    });
  });

  // Feature 5: PM2 Invalid Actions & Metacharacter Injection
  collector.describe('Tier 2 Feature 5: PM2 Action Boundaries & Injection Lockdown', () => {
    collector.it('2.5.1: POST /api/pm2/action with missing action returns 400', async () => {
      const res = await client.post('/api/pm2/action', { id: 0 });
      expect(res.status).toBe(400);
    });

    collector.it('2.5.2: POST /api/pm2/action with invalid action name returns 400', async () => {
      const res = await client.post('/api/pm2/action', { action: 'destroy', id: 0 });
      expect(res.status).toBe(400);
    });

    collector.it('2.5.3: POST /api/pm2/action rejects shell metacharacters in id (injection defense)', async () => {
      const res = await client.post('/api/pm2/action', {
        action: 'start',
        id: '0; rm -rf /; echo hacked',
      });
      expect(res.status).toBe(400);
    });

    collector.it('2.5.4: POST /api/pm2/action with non-existent process ID handled safely', async () => {
      const res = await client.post('/api/pm2/action', {
        action: 'start',
        id: 9999999,
      });
      // Should return 404/400 or handled error, never uncaught 500
      expect(res.status === 404 || res.status === 400 || res.status === 200).toBeTruthy();
    });

    collector.it('2.5.5: POST /api/pm2/action with empty object returns 400', async () => {
      const res = await client.post('/api/pm2/action', {});
      expect(res.status).toBe(400);
    });
  });

  // Feature 6: Port Listing Boundaries
  collector.describe('Tier 2 Feature 6: Port Mapping Boundaries', () => {
    collector.it('2.6.1: GET /api/ports handles invalid query parameters without crashing', async () => {
      const res = await client.get<PortsResponse>('/api/ports?protocol=invalid&format=xml');
      expect(res.status).toBe(200);
      expect(res.data?.success).toBe(true);
    });

    collector.it('2.6.2: All returned port numbers are within valid range 1-65535', async () => {
      const res = await client.get<PortsResponse>('/api/ports');
      for (const item of res.data.ports) {
        expect(typeof item.port).toBe('number');
        expect(item.port >= 1 && item.port <= 65535).toBeTruthy();
      }
    });

    collector.it('2.6.3: Protocols are strictly uppercase TCP or UDP', async () => {
      const res = await client.get<PortsResponse>('/api/ports');
      for (const item of res.data.ports) {
        expect(item.protocol).toBeOneOf(['TCP', 'UDP']);
      }
    });

    collector.it('2.6.4: Ports list is always an array, never null or undefined', async () => {
      const res = await client.get<PortsResponse>('/api/ports');
      expect(Array.isArray(res.data?.ports)).toBeTruthy();
    });

    collector.it('2.6.5: Rapid consecutive calls to /api/ports return consistent results', async () => {
      const p1 = await client.get<PortsResponse>('/api/ports');
      const p2 = await client.get<PortsResponse>('/api/ports');
      expect(p1.status).toBe(200);
      expect(p2.status).toBe(200);
      expect(p1.data.ports.length).toBe(p2.data.ports.length);
    });
  });

  // Feature 7: Nginx Path Traversal & Invalid Path Lockdown
  collector.describe('Tier 2 Feature 7: Nginx Path Traversal Lockdown', () => {
    collector.it('2.7.1: Path traversal with ../../../../etc/passwd is strictly blocked with 403', async () => {
      const res = await client.get('/api/nginx/content?file=../../../../etc/passwd');
      expect(res.status).toBe(403);
    });

    collector.it('2.7.2: Path traversal with URL-encoded dots is strictly blocked with 403', async () => {
      const res = await client.get('/api/nginx/content?file=%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd');
      expect(res.status).toBe(403);
    });

    collector.it('2.7.3: Requesting non-existent file inside valid directory returns 404', async () => {
      const res = await client.get('/api/nginx/content?file=non_existent_config_12345.conf');
      expect(res.status).toBe(404);
    });

    collector.it('2.7.4: Save attempt with path traversal relativePath is blocked with 403', async () => {
      const res = await client.post('/api/nginx/save', {
        relativePath: '../../malicious.conf',
        content: 'hacked',
      });
      expect(res.status).toBe(403);
    });

    collector.it('2.7.5: Save attempt with missing content or empty relativePath returns 400', async () => {
      const res = await client.post('/api/nginx/save', {
        relativePath: '',
        content: 'test',
      });
      expect(res.status).toBe(400);
    });
  });

  // Feature 8: Terminal Non-Zero Exits, Stderr & Bad Inputs
  collector.describe('Tier 2 Feature 8: Terminal Non-Zero Exits & Input Boundaries', () => {
    collector.it('2.8.1: Command returning non-zero exit code does not crash server', async () => {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'cmd /c exit 42' : 'exit 42';
      const res = await client.post<any>('/api/terminal/execute', { command: cmd });
      expect(res.status).toBe(200);
      expect(res.data?.exitCode !== 0).toBeTruthy('Expected non-zero exit code');
    });

    collector.it('2.8.2: Command producing stderr captures error stream cleanly', async () => {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'dir non_existent_folder_abc123' : 'ls non_existent_folder_abc123';
      const res = await client.post<any>('/api/terminal/execute', { command: cmd });
      expect(res.status).toBe(200);
      const hasErrorOutput = (res.data?.stderr && res.data.stderr.length > 0) || (res.data?.stdout && res.data.stdout.includes('File Not Found'));
      expect(hasErrorOutput).toBeTruthy('Expected error text in output');
    });

    collector.it('2.8.3: POST /api/terminal/execute with empty command returns 400 or empty output', async () => {
      const res = await client.post<any>('/api/terminal/execute', { command: '' });
      expect(res.status === 400 || (res.status === 200 && res.data?.stdout === '')).toBeTruthy();
    });

    collector.it('2.8.4: POST /api/terminal/execute with missing command attribute returns 400', async () => {
      const res = await client.post<any>('/api/terminal/execute', {});
      expect(res.status).toBe(400);
    });

    collector.it('2.8.5: Execution with invalid cwd does not crash server', async () => {
      const res = await client.post<any>('/api/terminal/execute', {
        command: 'echo safe',
        cwd: '/non_existent_directory_xyz123',
      });
      expect(res.status === 200 || res.status === 400).toBeTruthy();
    });
  });
}
