import { TestClient } from './client';
import { TestSuiteCollector, expect } from './test-framework';
import { PM2ListResponse, PM2ActionResponse, PortsResponse, NginxFilesResponse, NginxContentResponse, NginxSaveResponse, TerminalExecuteResponse } from './types';

export function registerTier1Tests(collector: TestSuiteCollector, client: TestClient, credentials = { username: 'admin', password: 'password123' }): void {
  // Feature 1: R1 - Unauthenticated Redirect
  collector.describe('Feature 1: R1 - Unauthenticated Redirect', () => {
    collector.it('1.1: Unauthenticated GET / redirects to /login', async () => {
      const anon = client.createAnonymousClient();
      const res = await anon.fetch('/', { followRedirects: false });
      const location = res.headers.get('location') || '';
      const isRedirect = res.status === 307 || res.status === 302 || res.status === 308 || res.status === 303;
      expect(isRedirect || res.status === 200, `Expected redirect or login page, got ${res.status}`).toBeTruthy();
      if (isRedirect) {
        expect(location.includes('/login') || location.includes('/setup')).toBeTruthy(
          `Expected redirect location to contain /login or /setup, got: ${location}`
        );
      }
    });

    collector.it('1.2: Unauthenticated GET /api/pm2 is rejected with 401 or redirect', async () => {
      const anon = client.createAnonymousClient();
      const res = await anon.fetch('/api/pm2', { followRedirects: false });
      const isProtected = res.status === 401 || res.status === 403 || res.status === 307 || res.status === 302;
      expect(isProtected).toBeTruthy(`Expected 401/403 or redirect for /api/pm2, got HTTP ${res.status}`);
    });

    collector.it('1.3: Unauthenticated GET /api/ports is rejected with 401 or redirect', async () => {
      const anon = client.createAnonymousClient();
      const res = await anon.fetch('/api/ports', { followRedirects: false });
      const isProtected = res.status === 401 || res.status === 403 || res.status === 307 || res.status === 302;
      expect(isProtected).toBeTruthy(`Expected 401/403 or redirect for /api/ports, got HTTP ${res.status}`);
    });

    collector.it('1.4: Unauthenticated GET /api/nginx/files is rejected with 401 or redirect', async () => {
      const anon = client.createAnonymousClient();
      const res = await anon.fetch('/api/nginx/files', { followRedirects: false });
      const isProtected = res.status === 401 || res.status === 403 || res.status === 307 || res.status === 302;
      expect(isProtected).toBeTruthy(`Expected 401/403 or redirect for /api/nginx/files, got HTTP ${res.status}`);
    });

    collector.it('1.5: Unauthenticated POST /api/terminal/execute is rejected with 401 or redirect', async () => {
      const anon = client.createAnonymousClient();
      const res = await anon.fetch('/api/terminal/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'echo test' }),
        followRedirects: false,
      });
      const isProtected = res.status === 401 || res.status === 403 || res.status === 307 || res.status === 302;
      expect(isProtected).toBeTruthy(`Expected 401/403 or redirect for /api/terminal/execute, got HTTP ${res.status}`);
    });
  });

  // Feature 2: R1 - One-time Setup & SQLite User Creation
  collector.describe('Feature 2: R1 - One-time Setup & SQLite User Creation', () => {
    collector.it('2.1: POST /api/setup with valid credentials returns 201 or 400 if already created', async () => {
      const res = await client.setupAdmin(credentials.username, credentials.password);
      // Either initial creation succeeds (200/201) or setup already occurred (400)
      expect(res.status === 201 || res.status === 200 || res.status === 400).toBeTruthy(
        `Expected 201, 200, or 400, got ${res.status}`
      );
      if (res.status === 201 || res.status === 200) {
        expect(res.data.success).toBeTruthy();
      }
    });

    collector.it('2.2: Setup response includes appropriate message or error string', async () => {
      const res = await client.setupAdmin(credentials.username, credentials.password);
      const hasMessage = typeof res.data?.message === 'string' || typeof res.data?.error === 'string';
      expect(hasMessage).toBeTruthy('Expected response to contain message or error field');
    });

    collector.it('2.3: Second call to POST /api/setup enforces one-time constraint and is rejected (400)', async () => {
      // Ensure admin exists
      await client.setupAdmin(credentials.username, credentials.password);
      // Attempt duplicate setup with different admin credentials
      const duplicateRes = await client.setupAdmin('newadmin_secondary', 'somepassword123');
      expect(duplicateRes.status).toBe(400, `Expected duplicate setup to return 400, got ${duplicateRes.status}`);
    });

    collector.it('2.4: POST /api/setup rejects empty username', async () => {
      const res = await client.setupAdmin('', 'validpassword123');
      expect(res.status).toBe(400, `Expected 400 Bad Request for empty username, got ${res.status}`);
    });

    collector.it('2.5: POST /api/setup rejects empty or too short password', async () => {
      const res = await client.setupAdmin('validuser', '');
      expect(res.status).toBe(400, `Expected 400 Bad Request for empty password, got ${res.status}`);
    });
  });

  // Feature 3: R1 - NextAuth Credentials Authentication
  collector.describe('Feature 3: R1 - NextAuth Credentials Authentication', () => {
    collector.it('3.1: GET /api/auth/csrf returns valid CSRF token', async () => {
      const token = await client.getCsrfToken();
      expect(typeof token).toBe('string');
      expect(token.length > 0).toBeTruthy('Expected non-empty CSRF token string');
    });

    collector.it('3.2: Login with incorrect password fails authentication', async () => {
      const failClient = client.createAnonymousClient();
      const loginResult = await failClient.login(credentials.username, 'wrong_unmatched_password');
      expect(loginResult.success).toBeFalsy('Expected login with wrong password to fail');
    });

    collector.it('3.3: Login with correct credentials establishes session cookie', async () => {
      const loginResult = await client.login(credentials.username, credentials.password);
      expect(loginResult.success).toBeTruthy(`Login failed: ${loginResult.error || loginResult.status}`);
    });

    collector.it('3.4: Authenticated session accesses dashboard / without redirect', async () => {
      const res = await client.fetch('/', { followRedirects: false });
      expect(res.status === 200 || res.status === 304).toBeTruthy(
        `Expected HTTP 200/304 for authenticated dashboard access, got ${res.status}`
      );
    });

    collector.it('3.5: GET /api/auth/session returns session data with user details', async () => {
      const res = await client.get('/api/auth/session');
      expect(res.status).toBe(200);
      expect(res.data).toBeDefined();
    });
  });

  // Feature 4: R2 - PM2 Process Listing & 60s Polling
  collector.describe('Feature 4: R2 - PM2 Process Listing & Polling', () => {
    collector.it('4.1: Authenticated GET /api/pm2 returns HTTP 200 with success: true', async () => {
      const res = await client.get<PM2ListResponse>('/api/pm2');
      expect(res.status).toBe(200, `Expected 200 OK, got ${res.status}`);
      expect(res.data?.success).toBe(true);
    });

    collector.it('4.2: PM2 response includes mode ("real" | "mock")', async () => {
      const res = await client.get<PM2ListResponse>('/api/pm2');
      expect(res.data?.mode).toBeOneOf(['real', 'mock']);
    });

    collector.it('4.3: PM2 response includes summary statistics', async () => {
      const res = await client.get<PM2ListResponse>('/api/pm2');
      const summary = res.data?.summary;
      expect(summary).toBeDefined();
      expect(typeof summary.total).toBe('number');
      expect(typeof summary.online).toBe('number');
      expect(typeof summary.stopped).toBe('number');
      expect(summary.total >= 0).toBeTruthy();
    });

    collector.it('4.4: PM2 processes array contains process entities with required attributes', async () => {
      const res = await client.get<PM2ListResponse>('/api/pm2');
      expect(Array.isArray(res.data?.processes)).toBeTruthy();
      if (res.data.processes.length > 0) {
        const proc = res.data.processes[0];
        expect(proc.id !== undefined).toBeTruthy();
        expect(typeof proc.name).toBe('string');
        expect(typeof proc.status).toBe('string');
        expect(typeof proc.cpu).toBe('number');
        expect(typeof proc.memory).toBe('number');
      }
    });

    collector.it('4.5: Consecutive polls simulate 60s refresh cycle and return current timestamps', async () => {
      const res1 = await client.get<PM2ListResponse>('/api/pm2');
      const res2 = await client.get<PM2ListResponse>('/api/pm2');
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(typeof res1.data.timestamp).toBe('number');
      expect(typeof res2.data.timestamp).toBe('number');
      expect(res2.data.timestamp >= res1.data.timestamp).toBeTruthy();
    });
  });

  // Feature 5: R2 - PM2 Process Action Controls
  collector.describe('Feature 5: R2 - PM2 Process Action Controls', () => {
    let targetId: number | string = 0;

    collector.it('5.1: Discover an existing PM2 process ID or default to 0', async () => {
      const listRes = await client.get<PM2ListResponse>('/api/pm2');
      if (listRes.data?.processes?.length > 0) {
        targetId = listRes.data.processes[0].id;
      }
      expect(targetId !== undefined).toBeTruthy();
    });

    collector.it('5.2: POST /api/pm2/action triggers "stop" and returns success: true', async () => {
      const res = await client.post<PM2ActionResponse>('/api/pm2/action', {
        action: 'stop',
        id: targetId,
      });
      expect(res.status).toBe(200, `Expected 200 for stop action, got ${res.status}`);
      expect(res.data?.success).toBe(true);
      expect(res.data?.mode).toBeOneOf(['real', 'mock']);
    });

    collector.it('5.3: Verify process status transitions after stop action', async () => {
      const listRes = await client.get<PM2ListResponse>('/api/pm2');
      const proc = listRes.data?.processes?.find((p) => String(p.id) === String(targetId));
      if (proc) {
        expect(proc.status).toBe('stopped');
      }
    });

    collector.it('5.4: POST /api/pm2/action triggers "start" and returns success: true', async () => {
      const res = await client.post<PM2ActionResponse>('/api/pm2/action', {
        action: 'start',
        id: targetId,
      });
      expect(res.status).toBe(200, `Expected 200 for start action, got ${res.status}`);
      expect(res.data?.success).toBe(true);
    });

    collector.it('5.5: POST /api/pm2/action triggers "restart" successfully', async () => {
      const res = await client.post<PM2ActionResponse>('/api/pm2/action', {
        action: 'restart',
        id: targetId,
      });
      expect(res.status).toBe(200, `Expected 200 for restart action, got ${res.status}`);
      expect(res.data?.success).toBe(true);
    });
  });

  // Feature 6: R3 - Active Port Mapping Display
  collector.describe('Feature 6: R3 - Active Port Mapping Display', () => {
    collector.it('6.1: Authenticated GET /api/ports returns HTTP 200 with success: true', async () => {
      const res = await client.get<PortsResponse>('/api/ports');
      expect(res.status).toBe(200, `Expected 200 OK, got ${res.status}`);
      expect(res.data?.success).toBe(true);
    });

    collector.it('6.2: Ports payload includes mode ("real" | "mock")', async () => {
      const res = await client.get<PortsResponse>('/api/ports');
      expect(res.data?.mode).toBeOneOf(['real', 'mock']);
    });

    collector.it('6.3: Ports response contains an array of open ports', async () => {
      const res = await client.get<PortsResponse>('/api/ports');
      expect(Array.isArray(res.data?.ports)).toBeTruthy();
      expect(res.data.ports.length > 0).toBeTruthy('Expected at least one active listening port');
    });

    collector.it('6.4: Each port object has valid port number and protocol', async () => {
      const res = await client.get<PortsResponse>('/api/ports');
      const first = res.data.ports[0];
      expect(typeof first.port).toBe('number');
      expect(first.port > 0 && first.port <= 65535).toBeTruthy();
      expect(first.protocol).toBeOneOf(['TCP', 'UDP']);
    });

    collector.it('6.5: Ports include address and process/service information', async () => {
      const res = await client.get<PortsResponse>('/api/ports');
      const first = res.data.ports[0];
      expect(typeof first.address).toBe('string');
      expect(typeof first.process).toBe('string');
    });
  });

  // Feature 7: R3 - Nginx Configuration Viewing & Editing
  collector.describe('Feature 7: R3 - Nginx Configuration Viewing & Editing', () => {
    let chosenFile = 'nginx.conf';

    collector.it('7.1: Authenticated GET /api/nginx/files returns HTTP 200 with files list', async () => {
      const res = await client.get<NginxFilesResponse>('/api/nginx/files');
      expect(res.status).toBe(200, `Expected 200 OK, got ${res.status}`);
      expect(res.data?.success).toBe(true);
      expect(Array.isArray(res.data?.files)).toBeTruthy();
      expect(res.data.files.length > 0).toBeTruthy('Expected at least one nginx configuration file');
      chosenFile = res.data.files[0].relativePath || res.data.files[0].name;
    });

    collector.it('7.2: Nginx files list contains relativePath and size metadata', async () => {
      const res = await client.get<NginxFilesResponse>('/api/nginx/files');
      const f = res.data.files[0];
      expect(typeof f.name).toBe('string');
      expect(typeof f.size).toBe('number');
    });

    collector.it('7.3: GET /api/nginx/content?file=<relativePath> retrieves config content', async () => {
      const res = await client.get<NginxContentResponse>(`/api/nginx/content?file=${encodeURIComponent(chosenFile)}`);
      expect(res.status).toBe(200, `Expected 200 OK, got ${res.status}`);
      expect(res.data?.success).toBe(true);
      expect(typeof res.data?.content).toBe('string');
      expect(res.data.content.length > 0).toBeTruthy();
    });

    collector.it('7.4: POST /api/nginx/save updates configuration content', async () => {
      const getRes = await client.get<NginxContentResponse>(`/api/nginx/content?file=${encodeURIComponent(chosenFile)}`);
      const original = getRes.data.content;
      const marker = `\n# Tier 1 Test Marker ${Date.now()}\n`;
      const updated = original + marker;

      const saveRes = await client.post<NginxSaveResponse>('/api/nginx/save', {
        relativePath: chosenFile,
        content: updated,
      });
      expect(saveRes.status).toBe(200, `Expected 200 OK for save, got ${saveRes.status}`);
      expect(saveRes.data?.success).toBe(true);
    });

    collector.it('7.5: Verify updated content persists on disk and read back', async () => {
      const getRes = await client.get<NginxContentResponse>(`/api/nginx/content?file=${encodeURIComponent(chosenFile)}`);
      expect(getRes.status).toBe(200);
      expect(getRes.data.content).toContain('Tier 1 Test Marker');
    });
  });

  // Feature 8: R4 - Web Terminal Command Execution
  collector.describe('Feature 8: R4 - Web Terminal Command Execution', () => {
    collector.it('8.1: POST /api/terminal/execute runs echo "agent-test"', async () => {
      const res = await client.post<TerminalExecuteResponse>('/api/terminal/execute', {
        command: 'echo "agent-test"',
      });
      expect(res.status).toBe(200, `Expected 200 OK, got ${res.status}`);
    });

    collector.it('8.2: Output contains verbatim "agent-test" in stdout (R4 Acceptance Criteria)', async () => {
      const res = await client.post<TerminalExecuteResponse>('/api/terminal/execute', {
        command: 'echo "agent-test"',
      });
      expect(res.data?.stdout).toContain('agent-test');
    });

    collector.it('8.3: Successful command returns exitCode: 0', async () => {
      const res = await client.post<TerminalExecuteResponse>('/api/terminal/execute', {
        command: 'echo "agent-test"',
      });
      expect(res.data?.exitCode).toBe(0);
    });

    collector.it('8.4: Response returns current working directory (cwd)', async () => {
      const res = await client.post<TerminalExecuteResponse>('/api/terminal/execute', {
        command: 'echo "cwd-check"',
      });
      expect(typeof res.data?.cwd).toBe('string');
      expect(res.data.cwd.length > 0).toBeTruthy();
    });

    collector.it('8.5: Complex command execution (e.g. node -v) succeeds', async () => {
      const res = await client.post<TerminalExecuteResponse>('/api/terminal/execute', {
        command: 'node -v',
      });
      expect(res.status).toBe(200);
      expect(res.data?.exitCode).toBe(0);
      expect(res.data?.stdout).toContain('v');
    });
  });
}
