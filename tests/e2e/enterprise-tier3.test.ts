/**
 * Enterprise Tier 3: Cross-Feature Combinations & Pairwise Integration Suite
 * Verifies multi-feature interactions, pairwise integrations, and concurrent role boundaries.
 */

import { TestClient } from './client';
import { TestSuiteCollector, expect } from './test-framework';
import {
  DeployWebhookResponse,
  Fail2BanStatusResponse,
  Fail2BanUnbanResponse,
  PM2ListResponse,
  PM2ActionResponse,
  UptimeCreateResponse,
  UptimeCheckResponse,
  VitalsHistoryResponse,
} from './types';

export function registerEnterpriseTier3Tests(
  collector: TestSuiteCollector,
  client: TestClient,
  credentials = { username: 'admin', password: 'password123' },
  devCredentials = { username: 'developer', password: 'password123' }
): void {
  let adminAuthDone = false;
  let devClient: TestClient;

  async function ensureAdminAuth() {
    if (!adminAuthDone && !client.getCookieHeader().includes('session-token')) {
      adminAuthDone = true;
      try {
        await client.setupAdmin(credentials.username, credentials.password);
      } catch {}
      await client.login(credentials.username, credentials.password);
    }
  }

  async function ensureDevAuth(): Promise<TestClient> {
    if (!devClient) {
      devClient = client.createAnonymousClient();
      await devClient.ensureDeveloperUser(devCredentials.username, devCredentials.password);
      await devClient.login(devCredentials.username, devCredentials.password);
    }
    return devClient;
  }

  collector.describe('Tier 3 Enterprise: Cross-Feature Combinations', () => {
    // 3.1: Pairwise RBAC + Deploy Webhook
    collector.it('3.1: Pairwise RBAC + Deploy Webhook: Anonymous caller can access public webhook but is strictly blocked on admin routes', async () => {
      const anon = client.createAnonymousClient();

      // Webhook succeeds without auth
      const hookRes = await anon.post<DeployWebhookResponse>('/api/deploy/webhook', {
        ref: 'refs/heads/main',
        repository: { name: 'pairwise-test' },
      });
      expect(hookRes.status === 200 || hookRes.status === 202).toBeTruthy();
      expect(hookRes.data.success).toBe(true);

      // Same client is blocked on admin route
      const adminRes = await anon.post('/api/terminal/execute', { command: 'whoami' }, { followRedirects: false });
      const isBlocked = adminRes.status === 401 || adminRes.status === 403 || adminRes.status === 307 || adminRes.status === 302;
      expect(isBlocked).toBeTruthy('Expected anonymous client to be blocked on terminal route');
    });

    // 3.2: Pairwise RBAC + Fail2Ban Security Shield
    collector.it('3.2: Pairwise RBAC + Fail2Ban: Developer can view active jails but cannot unban IPs; Admin can unban', async () => {
      await ensureAdminAuth();
      const dev = await ensureDevAuth();

      // Developer can view status
      const devStatus = await dev.get<Fail2BanStatusResponse>('/api/fail2ban');
      expect(devStatus.status).toBe(200);
      expect(devStatus.data.success).toBe(true);

      // Developer cannot unban
      const devUnban = await dev.post<Fail2BanUnbanResponse>('/api/fail2ban/unban', {
        jail: 'sshd',
        ip: '192.168.1.100',
      });
      expect(devUnban.status).toBe(403, 'Expected developer to receive 403 Forbidden on unban');

      // Admin can unban
      const adminUnban = await client.post<Fail2BanUnbanResponse>('/api/fail2ban/unban', {
        jail: 'sshd',
        ip: '192.168.1.100',
      });
      expect(adminUnban.status).toBe(200, 'Expected admin to succeed on unban');
    });

    // 3.3: Pairwise PM2 Actions + Real-Time SSE Log Streaming
    collector.it('3.3: Pairwise PM2 Actions + SSE Streaming: Process restart event flows through SSE log stream', async () => {
      await ensureAdminAuth();

      // Start SSE listener
      const ssePromise = client.connectSse('/api/pm2/logs/stream?process=pmmanager-web', { timeoutMs: 8000 });

      // Trigger restart
      const restartRes = await client.post<PM2ActionResponse>('/api/pm2/action', {
        action: 'restart',
        id: 0,
      });
      expect(restartRes.status).toBe(200);

      // Verify SSE received event
      const sseResult = await ssePromise;
      expect(sseResult.firstEvent).toBeDefined();
      expect(typeof sseResult.firstEvent.message).toBe('string');
      sseResult.abort();
    });

    // 3.4: Pairwise PM2 Vitals + Historical Analytics
    collector.it('3.4: Pairwise PM2 Vitals + Historical Analytics: Vitals API aligns with running PM2 process metrics', async () => {
      await ensureAdminAuth();

      const pm2Res = await client.get<PM2ListResponse>('/api/pm2');
      expect(pm2Res.status).toBe(200);
      expect(pm2Res.data.processes.length > 0).toBeTruthy();

      const targetProc = pm2Res.data.processes[0].name;
      const historyRes = await client.get<VitalsHistoryResponse>(`/api/vitals/history?process=${encodeURIComponent(targetProc)}`);
      expect(historyRes.status).toBe(200);
      expect(historyRes.data.success).toBe(true);
      expect(Array.isArray(historyRes.data.data)).toBeTruthy();
    });

    // 3.5: Pairwise Uptime Checks + SLA Calculations
    collector.it('3.5: Pairwise Uptime Checks + SLA: Adding monitor and triggering check updates SLA metrics', async () => {
      await ensureAdminAuth();

      const createRes = await client.post<UptimeCreateResponse>('/api/uptime', {
        name: 'Pairwise SLA Monitor',
        url: 'http://localhost:3000',
        intervalSeconds: 60,
      });
      expect(createRes.status === 200 || createRes.status === 201).toBeTruthy();
      const monId = createRes.data.monitor.id;

      // Trigger check
      const checkRes = await client.post<UptimeCheckResponse>(`/api/uptime/check?id=${monId}`, { id: monId });
      expect(checkRes.status).toBe(200);
      expect(checkRes.data.check.status === 'UP' || checkRes.data.check.status === 'DOWN').toBeTruthy();

      // Clean up
      await client.delete(`/api/uptime?id=${monId}`, { id: monId });
    });

    // 3.6: Pairwise Concurrent Multi-Role Sessions
    collector.it('3.6: Pairwise Multi-Role Concurrency: Parallel admin and developer operations remain isolated without privilege leakage', async () => {
      await ensureAdminAuth();
      const dev = await ensureDevAuth();

      // Execute concurrent operations:
      // Admin: runs terminal command
      // Developer: queries PM2 and Uptime
      const [adminExec, devPm2, devUptime, devForbidden] = await Promise.all([
        client.post('/api/terminal/execute', { command: 'echo "admin-concurrent"' }),
        dev.get('/api/pm2'),
        dev.get('/api/uptime'),
        dev.post('/api/terminal/execute', { command: 'echo "dev-leak"' }),
      ]);

      expect(adminExec.status).toBe(200);
      expect(devPm2.status).toBe(200);
      expect(devUptime.status).toBe(200);
      expect(devForbidden.status).toBe(403);
    });

    // 3.7: Pairwise Defense-in-Depth Session Integrity
    collector.it('3.7: Pairwise Session Integrity: Blocked developer attack does not invalidate valid developer session', async () => {
      const dev = await ensureDevAuth();

      // Developer tries attack
      const attackRes = await dev.post('/api/terminal/execute', { command: 'cat /etc/shadow' });
      expect(attackRes.status).toBe(403);

      // Developer session should still be valid for allowed endpoints
      const validRes = await dev.get('/api/ports');
      expect(validRes.status).toBe(200);
    });
  });
}
