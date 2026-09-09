/**
 * Enterprise Tier 4: Real-World Workloads & Complex Operational Lifecycles
 * Comprehensive scenarios exercising end-to-end multi-step enterprise workflows.
 */

import { TestClient } from './client';
import { TestSuiteCollector, expect } from './test-framework';
import {
  DeployWebhookResponse,
  Fail2BanStatusResponse,
  Fail2BanUnbanResponse,
  PM2ListResponse,
  UptimeListResponse,
  UptimeCreateResponse,
  UptimeCheckResponse,
  VitalsHistoryResponse,
} from './types';

export function registerEnterpriseTier4Tests(
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

  collector.describe('Tier 4 Enterprise: Real-World Application Workloads', () => {
    // Scenario 1: End-to-End Git Auto-Deployment Lifecycle
    collector.it('4.1: Scenario 1 - End-to-End Git Auto-Deployment Lifecycle', async () => {
      // Step 1: Anonymous webhook call simulating GitHub push event
      const anon = client.createAnonymousClient();
      const pushPayload = {
        ref: 'refs/heads/main',
        repository: { name: 'nexus-pmmanager', full_name: 'corp/nexus-pmmanager' },
        commits: [
          {
            id: 'commit_enterprise_release_v2',
            message: 'feat: enterprise extension rollout',
            timestamp: new Date().toISOString(),
          },
        ],
      };

      const webhookRes = await anon.post<DeployWebhookResponse>('/api/deploy/webhook', pushPayload, {
        headers: {
          'x-github-event': 'push',
          'x-github-delivery': 'delivery-uuid-12345',
        },
      });

      expect(webhookRes.status === 200 || webhookRes.status === 202).toBeTruthy();
      expect(webhookRes.data.success).toBe(true);
      expect(typeof webhookRes.data.deploymentId).toBe('string');
      expect(webhookRes.data.deploymentId.length > 0).toBeTruthy();

      // Step 2: Connect to SSE log streamer to observe deployment/process events
      await ensureAdminAuth();
      const sseResult = await client.connectSse('/api/pm2/logs/stream?process=pmmanager-web', { timeoutMs: 5000 });
      expect(sseResult.status).toBe(200);
      expect(sseResult.firstEvent).toBeDefined();
      sseResult.abort();

      // Step 3: Verify PM2 process is active and operational post-deployment
      const pm2Res = await client.get<PM2ListResponse>('/api/pm2');
      expect(pm2Res.status).toBe(200);
      expect(pm2Res.data.processes.length > 0).toBeTruthy();
    });

    // Scenario 2: Multi-User RBAC Audit & Privilege Escalation Lockdown
    collector.it('4.2: Scenario 2 - Multi-User RBAC Audit & Privilege Escalation Lockdown', async () => {
      // Step 1: Ensure both Admin and Developer accounts exist
      await ensureAdminAuth();
      const dev = await ensureDevAuth();

      // Step 2: Developer attempts privilege escalation across ALL admin routes
      const adminRoutes = [
        { path: '/api/terminal/execute', method: 'POST', body: { command: 'cat /etc/shadow' } },
        { path: '/api/nginx/files', method: 'GET' },
        { path: '/api/nginx/content?file=nginx.conf', method: 'GET' },
        { path: '/api/nginx/save', method: 'POST', body: { relativePath: 'nginx.conf', content: 'hacked' } },
        { path: '/api/env', method: 'GET' },
        { path: '/api/fail2ban/unban', method: 'POST', body: { jail: 'sshd', ip: '1.2.3.4' } },
      ];

      for (const route of adminRoutes) {
        let res;
        if (route.method === 'POST') {
          res = await dev.post(route.path, route.body);
        } else {
          res = await dev.get(route.path);
        }
        expect(res.status).toBe(403, `Developer MUST be blocked on ${route.path} with 403 Forbidden`);
      }

      // Step 3: Developer executes allowed operational tasks
      const devPm2 = await dev.get<PM2ListResponse>('/api/pm2');
      expect(devPm2.status).toBe(200);

      const devPorts = await dev.get('/api/ports');
      expect(devPorts.status).toBe(200);

      const devFail2ban = await dev.get('/api/fail2ban');
      expect(devFail2ban.status).toBe(200);

      const devUptime = await dev.get('/api/uptime');
      expect(devUptime.status).toBe(200);

      // Step 4: Admin performs privileged maintenance tasks successfully
      const adminTerm = await client.post('/api/terminal/execute', { command: 'echo "maintenance done"' });
      expect(adminTerm.status).toBe(200);

      const adminEnv = await client.get('/api/env');
      expect(adminEnv.status).toBe(200);
    });

    // Scenario 3: Full Uptime SLA Monitoring & Health Lifecycle
    collector.it('4.3: Scenario 3 - Full Uptime SLA Monitoring & Health Lifecycle', async () => {
      await ensureAdminAuth();

      // Step 1: Create monitor
      const createRes = await client.post<UptimeCreateResponse>('/api/uptime', {
        name: 'Workload Health Monitor',
        url: 'http://localhost:3000',
        intervalSeconds: 120,
      });
      expect(createRes.status === 200 || createRes.status === 201).toBeTruthy();
      const monId = createRes.data.monitor.id;

      // Step 2: Trigger immediate check
      const checkRes = await client.post<UptimeCheckResponse>(`/api/uptime/check?id=${monId}`, { id: monId });
      expect(checkRes.status).toBe(200);
      expect(checkRes.data.check.status === 'UP' || checkRes.data.check.status === 'DOWN').toBeTruthy();

      // Step 3: Query monitors list and verify presence and SLA
      const listRes = await client.get<UptimeListResponse>('/api/uptime');
      expect(listRes.status).toBe(200);
      const found = listRes.data.monitors.find((m) => m.id === monId);
      expect(found).toBeDefined('Expected created monitor in list');

      // Step 4: Cleanup
      const delRes = await client.delete(`/api/uptime?id=${monId}`, { id: monId });
      expect(delRes.status).toBe(200);
    });

    // Scenario 4: Fail2Ban Incident Response & Threat Mitigation Lifecycle
    collector.it('4.4: Scenario 4 - Fail2Ban Incident Response & Threat Mitigation Lifecycle', async () => {
      await ensureAdminAuth();
      const dev = await ensureDevAuth();

      // Step 1: Enumerate threat IPs
      const statusRes = await dev.get<Fail2BanStatusResponse>('/api/fail2ban');
      expect(statusRes.status).toBe(200);
      expect(statusRes.data.bannedList.length > 0).toBeTruthy('Expected at least one banned IP in status');

      const targetThreat = statusRes.data.bannedList[0];

      // Step 2: Developer attempts unban and is rejected
      const devAttempt = await dev.post<Fail2BanUnbanResponse>('/api/fail2ban/unban', {
        jail: targetThreat.jail,
        ip: targetThreat.ip,
      });
      expect(devAttempt.status).toBe(403);

      // Step 3: Admin executes authorized unban
      const adminUnban = await client.post<Fail2BanUnbanResponse>('/api/fail2ban/unban', {
        jail: targetThreat.jail,
        ip: targetThreat.ip,
      });
      expect(adminUnban.status).toBe(200);
      expect(adminUnban.data.success).toBe(true);
    });

    // Scenario 5: Real-Time Observability & Historical Telemetry Pipeline
    collector.it('4.5: Scenario 5 - Real-Time Observability & Historical Telemetry Pipeline', async () => {
      await ensureAdminAuth();

      // Step 1: Start SSE log listener
      const sseResult = await client.connectSse('/api/pm2/logs/stream?process=pmmanager-web', { timeoutMs: 5000 });
      expect(sseResult.status).toBe(200);
      expect(sseResult.firstEvent).toBeDefined();
      sseResult.abort();

      // Step 2: Query historical vitals trend
      const vitalsRes = await client.get<VitalsHistoryResponse>('/api/vitals/history?process=pmmanager-web&hours=24');
      expect(vitalsRes.status).toBe(200);
      expect(vitalsRes.data.success).toBe(true);
      expect(Array.isArray(vitalsRes.data.data)).toBeTruthy();

      // Step 3: Perform PM2 process list query and verify telemetry continuity
      const pm2Res = await client.get<PM2ListResponse>('/api/pm2');
      expect(pm2Res.status).toBe(200);
      expect(pm2Res.data.summary.total >= 1).toBeTruthy();
    });
  });
}
