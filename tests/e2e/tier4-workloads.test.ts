import { TestClient } from './client';
import { TestSuiteCollector, expect } from './test-framework';
import { PM2ListResponse, PM2ActionResponse, PortsResponse, NginxFilesResponse, NginxContentResponse, NginxSaveResponse, TerminalExecuteResponse } from './types';

export function registerTier4Tests(collector: TestSuiteCollector, client: TestClient, credentials = { username: 'admin', password: 'password123' }): void {
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

  collector.describe('Tier 4: Real-World Application Scenarios', () => {
    // Scenario 1: Fresh Install & Admin Setup Lifecycle
    collector.it('4.1: Scenario 1 - Fresh Install & Admin Setup Lifecycle', async () => {
      // Step 1: Unauthenticated user checks setup / dashboard
      const anon = client.createAnonymousClient();
      const initialGet = await anon.fetch('/', { followRedirects: false });
      expect(initialGet.status === 307 || initialGet.status === 302 || initialGet.status === 200).toBeTruthy();

      // Step 2: Attempt setup registration
      const setupRes = await anon.setupAdmin(credentials.username, credentials.password);
      expect(setupRes.status === 201 || setupRes.status === 200 || setupRes.status === 400).toBeTruthy();

      // Step 3: Validate subsequent setup calls are sealed
      const duplicateSetup = await anon.setupAdmin('secondary_admin', 'anotherpass123');
      expect(duplicateSetup.status).toBe(400, 'Expected secondary setup to be strictly rejected');

      // Step 4: Login with configured admin credentials
      const loginRes = await anon.login(credentials.username, credentials.password);
      expect(loginRes.success).toBeTruthy(`Admin login failed: ${loginRes.error}`);

      // Step 5: Verify authenticated access to dashboard succeeds
      const dashRes = await anon.fetch('/', { followRedirects: false });
      expect(dashRes.status === 200 || dashRes.status === 304).toBeTruthy();
    });

    // Scenario 2: PM2 Process Toggling & Metrics Lifecycle
    collector.it('4.2: Scenario 2 - PM2 Process Toggling & Metrics Lifecycle', async () => {
      await ensureAuth();
      // Step 1: Retrieve initial process list and summary
      const initialList = await client.get<PM2ListResponse>('/api/pm2');
      expect(initialList.status).toBe(200);
      expect(initialList.data.success).toBe(true);
      expect(initialList.data.processes.length > 0).toBeTruthy('Expected at least one PM2 process');

      const target = initialList.data.processes[0];
      const targetId = target.id;
      const initialSummary = initialList.data.summary;

      // Step 2: Stop target process
      const stopAction = await client.post<PM2ActionResponse>('/api/pm2/action', {
        action: 'stop',
        id: targetId,
      });
      expect(stopAction.status).toBe(200);
      expect(stopAction.data.success).toBe(true);

      // Step 3: Poll /api/pm2 to verify transition to stopped
      const afterStopList = await client.get<PM2ListResponse>('/api/pm2');
      const stoppedProc = afterStopList.data.processes.find((p) => String(p.id) === String(targetId));
      if (stoppedProc) {
        expect(stoppedProc.status).toBe('stopped');
        expect(stoppedProc.cpu).toBe(0);
      }

      // Step 4: Restart / Start process back to online
      const startAction = await client.post<PM2ActionResponse>('/api/pm2/action', {
        action: 'start',
        id: targetId,
      });
      expect(startAction.status).toBe(200);
      expect(startAction.data.success).toBe(true);

      // Step 5: Verify process returns to online state
      const afterStartList = await client.get<PM2ListResponse>('/api/pm2');
      const recoveredProc = afterStartList.data.processes.find((p) => String(p.id) === String(targetId));
      if (recoveredProc) {
        expect(recoveredProc.status).toBe('online');
      }

      // Step 6: Test restart action
      const restartAction = await client.post<PM2ActionResponse>('/api/pm2/action', {
        action: 'restart',
        id: targetId,
      });
      expect(restartAction.status).toBe(200);
      expect(restartAction.data.success).toBe(true);
    });

    // Scenario 3: Nginx Config Modification, Backup & Persistence Workflow
    collector.it('4.3: Scenario 3 - Nginx Config Modification & Persistence Workflow', async () => {
      // Step 1: Discover configuration files
      const filesRes = await client.get<NginxFilesResponse>('/api/nginx/files');
      expect(filesRes.status).toBe(200);
      expect(filesRes.data.files.length > 0).toBeTruthy();

      const targetFile = filesRes.data.files[0].relativePath || filesRes.data.files[0].name;

      // Step 2: Read current content
      const readRes = await client.get<NginxContentResponse>(`/api/nginx/content?file=${encodeURIComponent(targetFile)}`);
      expect(readRes.status).toBe(200);
      const originalContent = readRes.data.content;

      // Step 3: Append configuration block
      const upstreamSnippet = `\n# --- E2E Deployment Scenario Test ---\nupstream cluster_${Date.now()} {\n    server 127.0.0.1:8080;\n}\n`;
      const modifiedContent = originalContent + upstreamSnippet;

      // Step 4: Save configuration
      const saveRes = await client.post<NginxSaveResponse>('/api/nginx/save', {
        relativePath: targetFile,
        content: modifiedContent,
      });
      expect(saveRes.status).toBe(200);
      expect(saveRes.data.success).toBe(true);

      // Step 5: Re-fetch and verify content persistence
      const verifyRes = await client.get<NginxContentResponse>(`/api/nginx/content?file=${encodeURIComponent(targetFile)}`);
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.data.content).toContain('upstream cluster_');

      // Step 6: Revert modification cleanly
      const revertRes = await client.post<NginxSaveResponse>('/api/nginx/save', {
        relativePath: targetFile,
        content: originalContent,
      });
      expect(revertRes.status).toBe(200);

      const finalCheck = await client.get<NginxContentResponse>(`/api/nginx/content?file=${encodeURIComponent(targetFile)}`);
      expect(finalCheck.data.content).toBe(originalContent);
    });

    // Scenario 4: Terminal Administration & Host Execution Workflow
    collector.it('4.4: Scenario 4 - Terminal Administration & Host Execution Workflow', async () => {
      // Step 1: Run authoritative acceptance criteria command
      const echoRes = await client.post<TerminalExecuteResponse>('/api/terminal/execute', {
        command: 'echo "agent-test"',
      });
      expect(echoRes.status).toBe(200);
      expect(echoRes.data.stdout).toContain('agent-test');
      expect(echoRes.data.exitCode).toBe(0);

      // Step 2: Query host information (whoami / platform)
      const whoamiCmd = process.platform === 'win32' ? 'whoami' : 'whoami';
      const userRes = await client.post<TerminalExecuteResponse>('/api/terminal/execute', {
        command: whoamiCmd,
      });
      expect(userRes.status).toBe(200);
      expect(userRes.data.stdout.trim().length > 0).toBeTruthy();
      expect(userRes.data.exitCode).toBe(0);

      // Step 3: Working directory inspection & tracking
      const initialCwd = userRes.data.cwd;
      expect(typeof initialCwd).toBe('string');
      expect(initialCwd.length > 0).toBeTruthy();

      // Step 4: Run Node execution check via terminal
      const nodeRes = await client.post<TerminalExecuteResponse>('/api/terminal/execute', {
        command: 'node -e "console.log(123 * 456);"',
      });
      expect(nodeRes.status).toBe(200);
      expect(nodeRes.data.stdout).toContain('56088');
      expect(nodeRes.data.exitCode).toBe(0);
    });

    // Scenario 5: Defense-in-Depth Security & Traversal Lockdown
    collector.it('4.5: Scenario 5 - Complete Security & Defense-in-Depth Audit', async () => {
      const anon = client.createAnonymousClient();

      // Step 1: Verify all 7 core API endpoints reject anonymous calls
      const endpoints: Array<{ path: string; method: 'GET' | 'POST'; body?: any }> = [
        { path: '/api/pm2', method: 'GET' },
        { path: '/api/pm2/action', method: 'POST', body: { action: 'stop', id: 0 } },
        { path: '/api/ports', method: 'GET' },
        { path: '/api/nginx/files', method: 'GET' },
        { path: '/api/nginx/content?file=nginx.conf', method: 'GET' },
        { path: '/api/nginx/save', method: 'POST', body: { relativePath: 'nginx.conf', content: 'hack' } },
        { path: '/api/terminal/execute', method: 'POST', body: { command: 'echo hack' } },
      ];

      for (const ep of endpoints) {
        let res: Response;
        if (ep.method === 'GET') {
          res = await anon.fetch(ep.path, { followRedirects: false });
        } else {
          res = await anon.fetch(ep.path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(ep.body),
            followRedirects: false,
          });
        }
        const isSecure = res.status === 401 || res.status === 403 || res.status === 307 || res.status === 302;
        expect(isSecure, `Endpoint ${ep.path} was accessible unauthenticated with status ${res.status}`).toBeTruthy();
      }

      // Step 2: Comprehensive path traversal attack injection vectors
      const traversalVectors = [
        '../../../../../../../../etc/passwd',
        '..\\..\\..\\..\\windows\\system.ini',
        '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
        'conf.d/../../sensitive.db',
        '/etc/shadow',
      ];

      for (const vec of traversalVectors) {
        const trRes = await client.get(`/api/nginx/content?file=${encodeURIComponent(vec)}`);
        expect(
          trRes.status === 403 || trRes.status === 400 || trRes.status === 404,
          `Path traversal vector "${vec}" was not blocked (got HTTP ${trRes.status})`
        ).toBeTruthy();
      }

      // Step 3: Command injection attack injection vectors on PM2 action
      const injectionVectors = [
        '0; whoami',
        '0 && dir',
        '0 | rm -rf /',
        '`id`',
        '$(whoami)',
      ];

      for (const vec of injectionVectors) {
        const actRes = await client.post('/api/pm2/action', {
          action: 'start',
          id: vec,
        });
        expect(
          actRes.status === 400 || actRes.status === 404,
          `Injection vector "${vec}" was not rejected (got HTTP ${actRes.status})`
        ).toBeTruthy();
      }
    });
  });
}
