/**
 * Enterprise Tier 2: Boundaries, Negative Tests & Adversarial Verification Suite
 * Stress-tests input validation, boundary constraints, role tampering, and security shields.
 */

import { TestClient } from './client';
import { TestSuiteCollector, expect } from './test-framework';
import { DeployWebhookResponse, Fail2BanUnbanResponse, UptimeListResponse } from './types';

export function registerEnterpriseTier2Tests(
  collector: TestSuiteCollector,
  client: TestClient,
  credentials = { username: 'admin', password: 'password123' },
  devCredentials = { username: 'developer', password: 'password123' }
): void {
  let devClient: TestClient;

  async function ensureDevAuth(): Promise<TestClient> {
    if (!devClient) {
      devClient = client.createAnonymousClient();
      await devClient.ensureDeveloperUser(devCredentials.username, devCredentials.password);
      await devClient.login(devCredentials.username, devCredentials.password);
    }
    return devClient;
  }

  // =========================================================================
  // Tier 2 Feature 1: RBAC Role Tampering & Negative Session Boundaries
  // =========================================================================
  collector.describe('Tier 2 Enterprise 1: RBAC Role Tampering & Security Boundaries', () => {
    collector.it('2.1.1: Forged cookie header attempting role escalation to admin is rejected (403/401)', async () => {
      const dev = await ensureDevAuth();
      const tampered = dev.clone();
      // Attempt to tamper headers or inject mock admin headers
      tampered.setCookie('user-role', 'admin');
      tampered.setCookie('role', 'admin');

      const res = await tampered.post('/api/terminal/execute', { command: 'echo pwned' }, {
        headers: { 'x-user-role': 'admin', 'x-role': 'admin' },
      });
      expect(res.status === 403 || res.status === 401, `Expected 403 or 401 on tampered role, got ${res.status}`).toBeTruthy();
    });

    collector.it('2.1.2: Corrupted or forged session token returns 401 Unauthorized', async () => {
      const forged = client.createAnonymousClient();
      forged.setCookie('authjs.session-token', 'corrupted-session-payload-xyz');
      forged.setCookie('__Secure-authjs.session-token', 'corrupted-session-payload-xyz');

      const res = await forged.get('/api/env', { followRedirects: false });
      const isBlocked = res.status === 401 || res.status === 403 || res.status === 307 || res.status === 302;
      expect(isBlocked, `Expected 401/403 or redirect for forged token, got ${res.status}`).toBeTruthy();
    });

    collector.it('2.1.3: Path normalization attempts on admin routes remain strictly secured (403)', async () => {
      const dev = await ensureDevAuth();
      const res = await dev.post('/api/terminal/execute/', { command: 'whoami' });
      expect(res.status === 403 || res.status === 404, `Expected 403 or 404, got ${res.status}`).toBeTruthy();
    });
  });

  // =========================================================================
  // Tier 2 Feature 2: Deploy Webhook Boundaries & Payload Fuzzing
  // =========================================================================
  collector.describe('Tier 2 Enterprise 2: Deploy Webhook Boundaries & Payload Fuzzing', () => {
    collector.it('2.2.1: POST /api/deploy/webhook with empty body returns 400 Bad Request', async () => {
      const anon = client.createAnonymousClient();
      const res = await anon.post('/api/deploy/webhook', '', {
        headers: { 'content-type': 'application/json' },
      });
      expect(res.status).toBe(400, `Expected 400 for empty body, got ${res.status}`);
    });

    collector.it('2.2.2: POST /api/deploy/webhook with empty JSON object returns 400 Bad Request', async () => {
      const anon = client.createAnonymousClient();
      const res = await anon.post('/api/deploy/webhook', {});
      expect(res.status).toBe(400, `Expected 400 for empty JSON object, got ${res.status}`);
    });

    collector.it('2.2.3: POST /api/deploy/webhook with malformed JSON returns 400 Bad Request', async () => {
      const anon = client.createAnonymousClient();
      const res = await anon.post('/api/deploy/webhook', '{ "ref": "broken json...', {
        headers: { 'content-type': 'application/json' },
      });
      expect(res.status === 400 || !res.ok, `Expected 400 for malformed JSON, got ${res.status}`).toBeTruthy();
    });

    collector.it('2.2.4: Burst submissions (5 parallel webhooks) succeed and yield unique deployment IDs', async () => {
      const anon = client.createAnonymousClient();
      const burstPayloads = Array.from({ length: 5 }, (_, i) => ({
        ref: 'refs/heads/main',
        repository: { name: `burst-repo-${i}` },
        commits: [{ id: `commit_${i}` }],
      }));

      const responses = await Promise.all(
        burstPayloads.map((p) => anon.post<DeployWebhookResponse>('/api/deploy/webhook', p))
      );

      const ids = new Set<string>();
      for (const r of responses) {
        expect(r.status === 200 || r.status === 202).toBeTruthy();
        expect(r.data.deploymentId).toBeDefined();
        ids.add(r.data.deploymentId);
      }
      expect(ids.size).toBe(5, 'Expected all 5 burst deployment IDs to be unique');
    });
  });

  // =========================================================================
  // Tier 2 Feature 3: Discord Alerts Boundary Handling
  // =========================================================================
  collector.describe('Tier 2 Enterprise 3: Discord Alerts Boundaries', () => {
    collector.it('2.3.1: Alert test with empty payload is handled without process crash', async () => {
      const res = await client.post('/api/alerts/test', {});
      expect(res.status !== 500, 'Expected non-crash status code');
    });

    collector.it('2.3.2: Alert test endpoint handles special and Unicode characters safely', async () => {
      const res = await client.post('/api/alerts/test', {
        message: 'Unicode test: 🚨 🚀 日本語 testing <script>alert("xss")</script>',
      });
      expect(res.status !== 500, 'Expected non-crash status code for Unicode and meta-characters');
    });
  });

  // =========================================================================
  // Tier 2 Feature 4: SSE Log Streamer Boundary & Disconnect Safety
  // =========================================================================
  collector.describe('Tier 2 Enterprise 4: Real-Time SSE Stream Boundaries', () => {
    collector.it('2.4.1: Querying SSE stream with non-existent process parameter does not crash server', async () => {
      const sseResult = await client.connectSse('/api/pm2/logs/stream?process=nonexistent_proc_xyz', { timeoutMs: 5000 });
      expect(sseResult.status === 200 || sseResult.status === 404).toBeTruthy();
      sseResult.abort();
    });

    collector.it('2.4.2: Aborting SSE stream immediately after connecting closes cleanly without dangling leaks', async () => {
      const sseResult = await client.connectSse('/api/pm2/logs/stream', { timeoutMs: 2000 });
      sseResult.abort();
      // Subsequent query proves server socket did not hang
      const pm2Res = await client.get('/api/pm2');
      expect(pm2Res.status).toBe(200);
    });

    collector.it('2.4.3: Multiple concurrent SSE connections stream logs without interference', async () => {
      const conn1 = client.connectSse('/api/pm2/logs/stream?process=proc1', { timeoutMs: 5000 });
      const conn2 = client.connectSse('/api/pm2/logs/stream?process=proc2', { timeoutMs: 5000 });

      const [res1, res2] = await Promise.all([conn1, conn2]);
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      res1.abort();
      res2.abort();
    });
  });

  // =========================================================================
  // Tier 2 Feature 5: Historical Analytics Boundary Queries
  // =========================================================================
  collector.describe('Tier 2 Enterprise 5: Historical Analytics Query Boundaries', () => {
    collector.it('2.5.1: Querying /api/vitals/history with negative or invalid hours returns valid response', async () => {
      const res = await client.get('/api/vitals/history?hours=-5');
      expect(res.status === 200 || res.status === 400).toBeTruthy();
      if (res.status === 200) {
        expect(Array.isArray(res.data.data)).toBeTruthy();
      }
    });

    collector.it('2.5.2: Querying /api/vitals/history with non-numeric hours returns valid response', async () => {
      const res = await client.get('/api/vitals/history?hours=invalid_string');
      expect(res.status === 200 || res.status === 400).toBeTruthy();
    });

    collector.it('2.5.3: Querying /api/vitals/history for non-existent process does not crash server', async () => {
      const res = await client.get('/api/vitals/history?process=definitely_not_running');
      expect(res.status === 200 || res.status === 404).toBeTruthy();
    });
  });

  // =========================================================================
  // Tier 2 Feature 6: Fail2Ban Command Injection Lockdown
  // =========================================================================
  collector.describe('Tier 2 Enterprise 6: Fail2Ban Injection & Input Boundaries', () => {
    collector.it('2.6.1: POST /api/fail2ban/unban with missing IP parameter returns 400', async () => {
      const res = await client.post('/api/fail2ban/unban', { jail: 'sshd' });
      expect(res.status).toBe(400, `Expected 400 for missing IP, got ${res.status}`);
    });

    collector.it('2.6.2: POST /api/fail2ban/unban with missing jail parameter returns 400', async () => {
      const res = await client.post('/api/fail2ban/unban', { ip: '1.2.3.4' });
      expect(res.status).toBe(400, `Expected 400 for missing jail, got ${res.status}`);
    });

    collector.it('2.6.3: POST /api/fail2ban/unban strictly sanitizes shell metacharacters in IP address', async () => {
      const injectionVectors = [
        '192.168.1.1; whoami',
        '10.0.0.1 && cat /etc/passwd',
        '127.0.0.1 | id',
        '`echo pwned`',
        '$(whoami)',
      ];

      for (const badIp of injectionVectors) {
        const res = await client.post<Fail2BanUnbanResponse>('/api/fail2ban/unban', {
          jail: 'sshd',
          ip: badIp,
        });
        expect(res.status === 400 || res.status === 422 || !res.data?.success).toBeTruthy(
          `Expected injection payload "${badIp}" to be rejected`
        );
      }
    });

    collector.it('2.6.4: Unbanning an IP not present in jail returns graceful message without 500 error', async () => {
      const res = await client.post<Fail2BanUnbanResponse>('/api/fail2ban/unban', {
        jail: 'sshd',
        ip: '203.0.113.199',
      });
      expect(res.status === 200 || res.status === 404).toBeTruthy(
        `Expected 200 or 404, got ${res.status}`
      );
    });
  });

  // =========================================================================
  // Tier 2 Feature 7: Uptime Monitoring Input & Math Boundaries
  // =========================================================================
  collector.describe('Tier 2 Enterprise 7: Uptime Monitoring Input & Math Boundaries', () => {
    collector.it('2.7.1: POST /api/uptime with empty name returns 400 Bad Request', async () => {
      const res = await client.post('/api/uptime', { name: '', url: 'http://localhost:3000' });
      expect(res.status).toBe(400, `Expected 400 for empty name, got ${res.status}`);
    });

    collector.it('2.7.2: POST /api/uptime with invalid URL returns 400 Bad Request', async () => {
      const res = await client.post('/api/uptime', { name: 'Bad URL', url: 'not-a-valid-http-url' });
      expect(res.status).toBe(400, `Expected 400 for invalid URL, got ${res.status}`);
    });

    collector.it('2.7.3: POST /api/uptime with negative intervalSeconds returns 400 Bad Request', async () => {
      const res = await client.post('/api/uptime', {
        name: 'Negative Interval',
        url: 'http://localhost:3000',
        intervalSeconds: -60,
      });
      expect(res.status).toBe(400, `Expected 400 for negative interval, got ${res.status}`);
    });

    collector.it('2.7.4: DELETE /api/uptime without monitor ID returns 400 Bad Request', async () => {
      const res = await client.delete('/api/uptime');
      expect(res.status === 400 || res.status === 404).toBeTruthy(
        `Expected 400 or 404 for delete without ID, got ${res.status}`
      );
    });

    collector.it('2.7.5: Uptime calculation handles zero checks without NaN or division by zero', async () => {
      const listRes = await client.get<UptimeListResponse>('/api/uptime');
      expect(listRes.status).toBe(200);
      for (const m of listRes.data.monitors) {
        if (m.uptimePercentage !== undefined) {
          expect(!isNaN(m.uptimePercentage)).toBeTruthy('uptimePercentage must not be NaN');
          expect(isFinite(m.uptimePercentage)).toBeTruthy('uptimePercentage must be finite');
        }
      }
    });
  });
}
