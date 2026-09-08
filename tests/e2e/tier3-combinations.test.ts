import { TestClient } from './client';
import { TestSuiteCollector, expect } from './test-framework';
import { PM2ListResponse, PM2ActionResponse, PortsResponse, NginxFilesResponse, NginxContentResponse, NginxSaveResponse, TerminalExecuteResponse } from './types';

export function registerTier3Tests(collector: TestSuiteCollector, client: TestClient, credentials = { username: 'admin', password: 'password123' }): void {
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

  collector.describe('Tier 3: Cross-Feature Combinations', () => {
    // 3.1: Auth -> PM2 Listing
    collector.it('3.1: Pairwise Auth -> PM2 Listing: Session persistence and process retrieval', async () => {
      await ensureAuth();
      // Login fresh client
      const freshClient = client.createAnonymousClient();
      const loginRes = await freshClient.login(credentials.username, credentials.password);
      expect(loginRes.success).toBeTruthy();

      const pm2Res = await freshClient.get<PM2ListResponse>('/api/pm2');
      expect(pm2Res.status).toBe(200);
      expect(pm2Res.data.success).toBe(true);
      expect(Array.isArray(pm2Res.data.processes)).toBeTruthy();
    });

    // 3.2: Auth -> Active Ports Discovery
    collector.it('3.2: Pairwise Auth -> Port Discovery: Authenticated port mapping verification', async () => {
      const portRes = await client.get<PortsResponse>('/api/ports');
      expect(portRes.status).toBe(200);
      expect(portRes.data.success).toBe(true);
      expect(portRes.data.ports.length > 0).toBeTruthy();
    });

    // 3.3: Auth -> Nginx Config Discovery & Content Reading
    collector.it('3.3: Pairwise Auth -> Nginx Reader: Enumerate configs and read primary file', async () => {
      const filesRes = await client.get<NginxFilesResponse>('/api/nginx/files');
      expect(filesRes.status).toBe(200);
      expect(filesRes.data.files.length > 0).toBeTruthy();

      const targetFile = filesRes.data.files[0].relativePath || filesRes.data.files[0].name;
      const contentRes = await client.get<NginxContentResponse>(`/api/nginx/content?file=${encodeURIComponent(targetFile)}`);
      expect(contentRes.status).toBe(200);
      expect(typeof contentRes.data.content).toBe('string');
    });

    // 3.4: Auth -> Web Terminal Execution
    collector.it('3.4: Pairwise Auth -> Web Terminal: Run shell command under authenticated context', async () => {
      const termRes = await client.post<TerminalExecuteResponse>('/api/terminal/execute', {
        command: 'echo "pairwise-terminal-verified"',
      });
      expect(termRes.status).toBe(200);
      expect(termRes.data.stdout).toContain('pairwise-terminal-verified');
      expect(termRes.data.exitCode).toBe(0);
    });

    // 3.5: PM2 Process Action -> State Mutation & Metric Verification
    collector.it('3.5: Pairwise PM2 Action -> Metrics: Stop process and verify summary reflects stopped state', async () => {
      const listBefore = await client.get<PM2ListResponse>('/api/pm2');
      expect(listBefore.status).toBe(200);
      const targetId = listBefore.data.processes[0]?.id ?? 0;

      // Stop
      const stopRes = await client.post<PM2ActionResponse>('/api/pm2/action', { action: 'stop', id: targetId });
      expect(stopRes.status).toBe(200);

      // Verify list
      const listAfterStop = await client.get<PM2ListResponse>('/api/pm2');
      const stoppedProc = listAfterStop.data.processes.find((p) => String(p.id) === String(targetId));
      if (stoppedProc) {
        expect(stoppedProc.status).toBe('stopped');
      }

      // Restore: Start
      const startRes = await client.post<PM2ActionResponse>('/api/pm2/action', { action: 'start', id: targetId });
      expect(startRes.status).toBe(200);

      const listAfterStart = await client.get<PM2ListResponse>('/api/pm2');
      const startedProc = listAfterStart.data.processes.find((p) => String(p.id) === String(targetId));
      if (startedProc) {
        expect(startedProc.status).toBe('online');
      }
    });

    // 3.6: Nginx Content Editing -> Verification & Re-Reading
    collector.it('3.6: Pairwise Nginx Edit -> Persistence: Edit config, save, and verify content', async () => {
      const filesRes = await client.get<NginxFilesResponse>('/api/nginx/files');
      const file = filesRes.data.files[0].relativePath || filesRes.data.files[0].name;

      const readRes = await client.get<NginxContentResponse>(`/api/nginx/content?file=${encodeURIComponent(file)}`);
      const original = readRes.data.content;
      const marker = `# Pairwise marker ${Date.now()}`;
      const modified = `${original}\n${marker}\n`;

      const saveRes = await client.post<NginxSaveResponse>('/api/nginx/save', {
        relativePath: file,
        content: modified,
      });
      expect(saveRes.status).toBe(200);

      const verifyRes = await client.get<NginxContentResponse>(`/api/nginx/content?file=${encodeURIComponent(file)}`);
      expect(verifyRes.data.content).toContain(marker);
    });

    // 3.7: Terminal File Creation -> Terminal Directory Verification -> Terminal Cleanup
    collector.it('3.7: Pairwise Terminal Lifecycle: Create temp file, verify with shell, and delete', async () => {
      const isWin = process.platform === 'win32';
      const tempFileName = `e2e_comb_${Date.now()}.txt`;
      const createCmd = isWin
        ? `cmd /c "echo combination-ok > ${tempFileName}"`
        : `echo "combination-ok" > ${tempFileName}`;
      const readCmd = isWin ? `type ${tempFileName}` : `cat ${tempFileName}`;
      const delCmd = isWin ? `del ${tempFileName}` : `rm ${tempFileName}`;

      const cRes = await client.post<TerminalExecuteResponse>('/api/terminal/execute', { command: createCmd });
      expect(cRes.status).toBe(200);

      const rRes = await client.post<TerminalExecuteResponse>('/api/terminal/execute', { command: readCmd });
      expect(rRes.status).toBe(200);
      expect(rRes.data.stdout).toContain('combination-ok');

      const dRes = await client.post<TerminalExecuteResponse>('/api/terminal/execute', { command: delCmd });
      expect(dRes.status).toBe(200);
    });

    // 3.8: Security Attack Rejection -> Session Integrity Preserved
    collector.it('3.8: Pairwise Security Defense: Blocked attack does not corrupt active session', async () => {
      // 1. Attempt path traversal (attack)
      const attackRes = await client.get('/api/nginx/content?file=../../../../etc/passwd');
      expect(attackRes.status).toBe(403);

      // 2. Verify that immediate subsequent normal request still succeeds with existing session
      const normalRes = await client.get<PM2ListResponse>('/api/pm2');
      expect(normalRes.status).toBe(200);
      expect(normalRes.data.success).toBe(true);
    });

    // 3.9: Concurrent Workloads: PM2 Polling + Terminal Execution
    collector.it('3.9: Pairwise Concurrency: Simultaneous PM2 list query and Terminal execution', async () => {
      const [pm2Result, termResult] = await Promise.all([
        client.get<PM2ListResponse>('/api/pm2'),
        client.post<TerminalExecuteResponse>('/api/terminal/execute', { command: 'echo "concurrent-workload"' }),
      ]);

      expect(pm2Result.status).toBe(200);
      expect(pm2Result.data.success).toBe(true);
      expect(termResult.status).toBe(200);
      expect(termResult.data.stdout).toContain('concurrent-workload');
    });

    // 3.10: Full Multi-Feature Pipeline Cycle
    collector.it('3.10: Pairwise Full Cycle: PM2 -> Ports -> Nginx -> Terminal under single session', async () => {
      // 1. Check PM2
      const pm2 = await client.get<PM2ListResponse>('/api/pm2');
      expect(pm2.status).toBe(200);

      // 2. Check Ports
      const ports = await client.get<PortsResponse>('/api/ports');
      expect(ports.status).toBe(200);

      // 3. Check Nginx
      const nginx = await client.get<NginxFilesResponse>('/api/nginx/files');
      expect(nginx.status).toBe(200);

      // 4. Check Terminal
      const terminal = await client.post<TerminalExecuteResponse>('/api/terminal/execute', { command: 'echo "pipeline-complete"' });
      expect(terminal.status).toBe(200);
      expect(terminal.data.stdout).toContain('pipeline-complete');
    });
  });
}
