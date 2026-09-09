import http from 'node:http';

export interface MockServerOptions {
  port?: number;
}

export class MockE2EServer {
  private server: http.Server | null = null;
  private adminConfigured = false;
  private activeSessionToken = 'test-e2e-session-token-valid';
  private developerSessionToken = 'test-e2e-session-token-developer';
  private currentCwd = process.cwd();
  private nginxFiles: Record<string, string> = {
    'nginx.conf': 'user www-data;\nworker_processes auto;\nevents { worker_connections 1024; }\n',
    'conf.d/pmmanager.conf': 'server {\n    listen 80;\n    server_name localhost;\n}\n',
  };
  private pm2Processes = [
    {
      id: 0,
      name: 'pmmanager-web',
      pid: 12345,
      status: 'online' as const,
      mode: 'fork' as const,
      cpu: 2.1,
      memory: 45000000,
      uptime: Date.now() - 3600000,
      restarts: 0,
    },
  ];
  private uptimeMonitors: any[] = [
    {
      id: 1,
      name: 'Production Web App',
      url: 'https://example.com/health',
      intervalSeconds: 60,
      createdAt: new Date().toISOString(),
      uptimePercentage: 99.9,
      avgResponseTimeMs: 42.5,
      lastStatus: 'UP' as const,
    },
  ];
  private fail2banBanned: any[] = [
    { ip: '192.168.1.100', jail: 'sshd', bannedAt: new Date().toISOString() },
    { ip: '10.0.0.50', jail: 'nginx-http-auth', bannedAt: new Date().toISOString() },
  ];

  public async start(port = 39999): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(port, '127.0.0.1', () => {
        const addr = this.server?.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        resolve(actualPort);
      });

      this.server.on('error', reject);
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.closeAllConnections();
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private getUserRole(req: http.IncomingMessage): 'admin' | 'developer' | null {
    const cookie = req.headers.cookie || '';
    if (cookie.includes(this.activeSessionToken)) {
      return 'admin';
    }
    if (cookie.includes(this.developerSessionToken)) {
      return 'developer';
    }
    return null;
  }

  private isAuthenticated(req: http.IncomingMessage): boolean {
    return this.getUserRole(req) !== null;
  }

  private isAdminOnlyRoute(pathname: string): boolean {
    if (pathname === '/api/terminal/execute') return true;
    if (pathname.startsWith('/api/nginx/')) return true;
    if (pathname === '/api/env') return true;
    if (pathname === '/api/fail2ban/unban') return true;
    return false;
  }

  private sendJson(res: http.ServerResponse, status: number, data: any, headers: Record<string, string> = {}) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      ...headers,
    });
    res.end(JSON.stringify(data));
  }

  private sendRedirect(res: http.ServerResponse, location: string, status = 307) {
    res.writeHead(status, { Location: location });
    res.end();
  }

  private async readBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const ctype = req.headers['content-type'] || '';
        if (ctype.includes('application/json')) {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(body);
          }
        } else if (ctype.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams(body);
          const obj: Record<string, string> = {};
          for (const [k, v] of params.entries()) {
            obj[k] = v;
          }
          resolve(obj);
        } else {
          resolve(body);
        }
      });
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname;
    const role = this.getUserRole(req);
    const isAuth = role !== null;

    // Root page
    if (pathname === '/') {
      if (!isAuth) {
        return this.sendRedirect(res, '/login');
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html><body>Dashboard</body></html>');
    }

    // CSRF
    if (pathname === '/api/auth/csrf') {
      return this.sendJson(
        res,
        200,
        { csrfToken: 'e2e-csrf-token-12345' },
        { 'Set-Cookie': 'authjs.csrf-token=e2e-csrf-token-12345; Path=/' }
      );
    }

    // NextAuth Credentials Callback
    if (pathname === '/api/auth/callback/credentials') {
      const body = await this.readBody(req);
      if (body.username === 'admin' && body.password === 'password123') {
        return this.sendJson(
          res,
          200,
          { url: 'http://localhost:3000/' },
          { 'Set-Cookie': `authjs.session-token=${this.activeSessionToken}; Path=/; HttpOnly` }
        );
      }
      if (body.username === 'developer' && body.password === 'password123') {
        return this.sendJson(
          res,
          200,
          { url: 'http://localhost:3000/' },
          { 'Set-Cookie': `authjs.session-token=${this.developerSessionToken}; Path=/; HttpOnly` }
        );
      }
      return this.sendRedirect(res, '/login?error=CredentialsSignin', 302);
    }

    // NextAuth Session
    if (pathname === '/api/auth/session') {
      if (role === 'admin') {
        return this.sendJson(res, 200, {
          user: { name: 'admin', email: null, image: null, role: 'admin' },
          expires: new Date(Date.now() + 86400000).toISOString(),
        });
      }
      if (role === 'developer') {
        return this.sendJson(res, 200, {
          user: { name: 'developer', email: null, image: null, role: 'developer' },
          expires: new Date(Date.now() + 86400000).toISOString(),
        });
      }
      return this.sendJson(res, 200, {});
    }

    // Setup Endpoint
    if (pathname === '/api/setup') {
      if (req.method !== 'POST') {
        return this.sendJson(res, 405, { error: 'Method not allowed' });
      }
      const body = await this.readBody(req);
      if (!body.username || typeof body.username !== 'string' || body.username.trim() === '') {
        return this.sendJson(res, 400, { error: 'Username required' });
      }
      if (!body.password || typeof body.password !== 'string' || body.password.length < 6) {
        return this.sendJson(res, 400, { error: 'Password minimum 6 characters required' });
      }
      if (this.adminConfigured) {
        return this.sendJson(res, 400, { error: 'Admin already configured' });
      }
      this.adminConfigured = true;
      return this.sendJson(res, 201, { success: true, message: 'Admin created' });
    }

    // Public Git Deployment Webhook (whitelisted, no auth required)
    if (pathname === '/api/deploy/webhook') {
      if (req.method !== 'POST') {
        return this.sendJson(res, 405, { error: 'Method not allowed' });
      }
      const ctype = req.headers['content-type'] || '';
      const body = await this.readBody(req);
      if (ctype.includes('application/json') && typeof body === 'string') {
        return this.sendJson(res, 400, { error: 'Malformed JSON payload' });
      }
      if (!body || (typeof body === 'string' && body.trim() === '') || (typeof body === 'object' && Object.keys(body).length === 0)) {
        return this.sendJson(res, 400, { error: 'Missing or empty payload' });
      }
      const deploymentId = 'deploy_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      return this.sendJson(res, 200, {
        success: true,
        message: 'Deployment triggered',
        deploymentId,
        status: 'queued',
      });
    }

    // Protected API Endpoints Guard & RBAC enforcement
    if (pathname.startsWith('/api/')) {
      if (!isAuth) {
        return this.sendJson(res, 401, { error: 'Unauthorized' });
      }
      if (this.isAdminOnlyRoute(pathname) && role !== 'admin') {
        return this.sendJson(res, 403, { error: 'Forbidden' });
      }
    }

    // Environment variables endpoint (Admin only)
    if (pathname === '/api/env') {
      return this.sendJson(res, 200, {
        success: true,
        env: {
          NODE_ENV: 'test',
          PORT: '3000',
          NEXTAUTH_URL: 'http://localhost:3000',
        },
      });
    }

    // Discord Alert Test Endpoint
    if (pathname === '/api/discord/test' || pathname === '/api/alerts/test') {
      return this.sendJson(res, 200, {
        success: true,
        statusCode: 204,
        message: 'Discord webhook test delivered',
      });
    }

    // Real-Time SSE Log Streamer
    if (pathname === '/api/pm2/logs/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const initialEvent = {
        timestamp: new Date().toISOString(),
        process: url.searchParams.get('process') || 'pmmanager-web',
        type: 'stdout',
        message: 'PM2 live log stream connected successfully',
      };
      res.write(`data: ${JSON.stringify(initialEvent)}\n\n`);

      const timer = setInterval(() => {
        const pingEvent = {
          timestamp: new Date().toISOString(),
          process: url.searchParams.get('process') || 'pmmanager-web',
          type: 'stdout',
          message: `Periodic metric heartbeat at ${new Date().toISOString()}`,
        };
        try {
          res.write(`data: ${JSON.stringify(pingEvent)}\n\n`);
        } catch {
          clearInterval(timer);
        }
      }, 3000);

      req.on('close', () => {
        clearInterval(timer);
        res.end();
      });
      return;
    }

    // Historical Vitals API
    if (pathname === '/api/vitals/history') {
      const hours = parseInt(url.searchParams.get('hours') || '24', 10);
      const proc = url.searchParams.get('process') || 'pmmanager-web';
      const now = Date.now();
      const vitals = [
        {
          id: 1,
          processId: '0',
          processName: proc,
          cpu: 2.1,
          memory: 45000000,
          timestamp: new Date(now - 600000).toISOString(),
        },
        {
          id: 2,
          processId: '0',
          processName: proc,
          cpu: 3.5,
          memory: 46200000,
          timestamp: new Date(now - 300000).toISOString(),
        },
        {
          id: 3,
          processId: '0',
          processName: proc,
          cpu: 1.8,
          memory: 44800000,
          timestamp: new Date(now).toISOString(),
        },
      ];
      return this.sendJson(res, 200, {
        success: true,
        process: proc,
        hours,
        data: vitals,
      });
    }

    // Fail2Ban Security Shield Status
    if (pathname === '/api/fail2ban') {
      return this.sendJson(res, 200, {
        success: true,
        mode: 'mock',
        jails: [
          {
            name: 'sshd',
            currentlyFailed: 3,
            totalFailed: 18,
            currentlyBanned: this.fail2banBanned.filter((b) => b.jail === 'sshd').length,
            totalBanned: 6,
            bannedIPs: this.fail2banBanned.filter((b) => b.jail === 'sshd').map((b) => b.ip),
          },
          {
            name: 'nginx-http-auth',
            currentlyFailed: 1,
            totalFailed: 8,
            currentlyBanned: this.fail2banBanned.filter((b) => b.jail === 'nginx-http-auth').length,
            totalBanned: 3,
            bannedIPs: this.fail2banBanned.filter((b) => b.jail === 'nginx-http-auth').map((b) => b.ip),
          },
        ],
        bannedList: this.fail2banBanned,
      });
    }

    // Fail2Ban Unban Action (Admin only)
    if (pathname === '/api/fail2ban/unban') {
      if (req.method !== 'POST') {
        return this.sendJson(res, 405, { error: 'Method not allowed' });
      }
      const body = await this.readBody(req);
      if (!body.jail || !body.ip) {
        return this.sendJson(res, 400, { error: 'Missing jail or ip parameter' });
      }
      const strIp = String(body.ip);
      if (/[;&|`$]/.test(strIp)) {
        return this.sendJson(res, 400, { error: 'Invalid IP address. Malformed characters detected' });
      }
      this.fail2banBanned = this.fail2banBanned.filter((b) => b.ip !== strIp);
      return this.sendJson(res, 200, {
        success: true,
        mode: 'mock',
        message: `IP ${strIp} unbanned from jail ${body.jail}`,
      });
    }

    // Uptime Monitoring API
    if (pathname === '/api/uptime') {
      if (req.method === 'GET') {
        return this.sendJson(res, 200, {
          success: true,
          monitors: this.uptimeMonitors,
        });
      }

      if (req.method === 'POST') {
        const body = await this.readBody(req);
        if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
          return this.sendJson(res, 400, { error: 'Monitor name is required' });
        }
        if (!body.url || typeof body.url !== 'string' || !body.url.startsWith('http')) {
          return this.sendJson(res, 400, { error: 'Valid HTTP/HTTPS URL is required' });
        }
        if (body.intervalSeconds !== undefined && Number(body.intervalSeconds) <= 0) {
          return this.sendJson(res, 400, { error: 'Interval must be greater than zero' });
        }
        const newMonitor = {
          id: Date.now(),
          name: body.name.trim(),
          url: body.url.trim(),
          intervalSeconds: Number(body.intervalSeconds) || 300,
          createdAt: new Date().toISOString(),
          uptimePercentage: 100.0,
          avgResponseTimeMs: 45.0,
          lastStatus: 'UP' as const,
        };
        this.uptimeMonitors.push(newMonitor);
        return this.sendJson(res, 201, { success: true, monitor: newMonitor });
      }

      if (req.method === 'DELETE') {
        const idParam = url.searchParams.get('id');
        const body = await this.readBody(req);
        const id = Number(idParam || body?.id);
        if (!id) {
          return this.sendJson(res, 400, { error: 'Missing monitor ID' });
        }
        this.uptimeMonitors = this.uptimeMonitors.filter((m) => m.id !== id);
        return this.sendJson(res, 200, { success: true, message: 'Monitor deleted successfully' });
      }

      return this.sendJson(res, 405, { error: 'Method not allowed' });
    }

    // Uptime Check Trigger
    if (pathname === '/api/uptime/check') {
      const idParam = url.searchParams.get('id');
      const body = await this.readBody(req);
      const id = Number(idParam || body?.id || 1);
      return this.sendJson(res, 200, {
        success: true,
        check: {
          id: Date.now(),
          monitorId: id,
          statusCode: 200,
          responseTimeMs: 38.4,
          status: 'UP',
          error: null,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // PM2 List
    if (pathname === '/api/pm2') {
      const online = this.pm2Processes.filter((p) => p.status === 'online').length;
      const stopped = this.pm2Processes.filter((p) => p.status === 'stopped').length;
      return this.sendJson(res, 200, {
        success: true,
        mode: 'mock',
        timestamp: Date.now(),
        summary: {
          total: this.pm2Processes.length,
          online,
          stopped,
          totalMemoryBytes: 45000000,
          avgCpuPercent: 2.1,
        },
        processes: this.pm2Processes,
      });
    }

    // PM2 Action
    if (pathname === '/api/pm2/action') {
      if (req.method !== 'POST') {
        return this.sendJson(res, 405, { error: 'Method not allowed' });
      }
      const body = await this.readBody(req);
      if (!body.action || !['start', 'stop', 'restart'].includes(body.action)) {
        return this.sendJson(res, 400, { error: 'Invalid or missing action' });
      }
      if (body.id === undefined || body.id === null) {
        return this.sendJson(res, 400, { error: 'Missing process ID' });
      }
      const strId = String(body.id);
      if (/[;&|`$]/.test(strId)) {
        return this.sendJson(res, 400, { error: 'Invalid process ID. Alphanumeric only' });
      }
      const proc = this.pm2Processes.find((p) => String(p.id) === strId);
      if (!proc) {
        return this.sendJson(res, 404, { error: 'Process not found' });
      }

      if (body.action === 'stop') {
        proc.status = 'stopped';
        proc.cpu = 0;
      } else if (body.action === 'start') {
        proc.status = 'online';
        proc.cpu = 2.0;
      } else if (body.action === 'restart') {
        proc.status = 'online';
        proc.restarts++;
      }

      return this.sendJson(res, 200, {
        success: true,
        mode: 'mock',
        message: `Process ${strId} ${body.action} executed`,
      });
    }

    // Ports
    if (pathname === '/api/ports') {
      return this.sendJson(res, 200, {
        success: true,
        mode: 'mock',
        ports: [
          { port: 80, protocol: 'TCP', address: '0.0.0.0', process: 'nginx', pid: 100, state: 'LISTEN' },
          { port: 443, protocol: 'TCP', address: '0.0.0.0', process: 'nginx', pid: 100, state: 'LISTEN' },
          { port: 3000, protocol: 'TCP', address: '127.0.0.1', process: 'node', pid: 12345, state: 'LISTEN' },
        ],
      });
    }

    // Nginx Files
    if (pathname === '/api/nginx/files') {
      const files = Object.keys(this.nginxFiles).map((k) => ({
        name: k.split('/').pop() || k,
        relativePath: k,
        size: Buffer.byteLength(this.nginxFiles[k]),
        modifiedAt: new Date().toISOString(),
      }));
      return this.sendJson(res, 200, { success: true, files });
    }

    // Nginx Content
    if (pathname === '/api/nginx/content') {
      const file = url.searchParams.get('file') || '';
      if (file.includes('..') || file.includes('%2e') || file.startsWith('/')) {
        return this.sendJson(res, 403, { error: 'Path traversal forbidden' });
      }
      if (!this.nginxFiles[file]) {
        return this.sendJson(res, 404, { error: 'File not found' });
      }
      return this.sendJson(res, 200, {
        success: true,
        relativePath: file,
        content: this.nginxFiles[file],
      });
    }

    // Nginx Save
    if (pathname === '/api/nginx/save') {
      if (req.method !== 'POST') {
        return this.sendJson(res, 405, { error: 'Method not allowed' });
      }
      const body = await this.readBody(req);
      if (!body.relativePath || typeof body.relativePath !== 'string' || body.relativePath.trim() === '') {
        return this.sendJson(res, 400, { error: 'Missing relativePath' });
      }
      if (body.content === undefined || body.content === null) {
        return this.sendJson(res, 400, { error: 'Missing content' });
      }
      if (body.relativePath.includes('..') || body.relativePath.startsWith('/')) {
        return this.sendJson(res, 403, { error: 'Path traversal forbidden' });
      }
      this.nginxFiles[body.relativePath] = String(body.content);
      return this.sendJson(res, 200, { success: true, message: 'Configuration saved' });
    }

    // Terminal Execute
    if (pathname === '/api/terminal/execute') {
      if (req.method !== 'POST') {
        return this.sendJson(res, 405, { error: 'Method not allowed' });
      }
      const body = await this.readBody(req);
      if (body.command === undefined || typeof body.command !== 'string') {
        return this.sendJson(res, 400, { error: 'Missing command' });
      }

      const cmd = body.command.trim();
      if (cmd === '') {
        return this.sendJson(res, 200, { stdout: '', stderr: '', exitCode: 0, cwd: this.currentCwd });
      }

      // Emulate basic commands for test verification
      if (cmd.includes('echo "agent-test"') || cmd === 'echo agent-test') {
        return this.sendJson(res, 200, {
          stdout: 'agent-test\n',
          stderr: '',
          exitCode: 0,
          cwd: this.currentCwd,
        });
      }

      if (cmd.startsWith('echo ')) {
        const text = cmd.substring(5).replace(/^["']|["']$/g, '');
        return this.sendJson(res, 200, {
          stdout: `${text}\n`,
          stderr: '',
          exitCode: 0,
          cwd: this.currentCwd,
        });
      }

      if (cmd.includes('exit 42')) {
        return this.sendJson(res, 200, {
          stdout: '',
          stderr: '',
          exitCode: 42,
          cwd: this.currentCwd,
        });
      }

      if (cmd.includes('non_existent')) {
        return this.sendJson(res, 200, {
          stdout: '',
          stderr: 'File Not Found / directory not found\n',
          exitCode: 1,
          cwd: this.currentCwd,
        });
      }

      if (cmd === 'whoami') {
        return this.sendJson(res, 200, {
          stdout: `${process.env.USERNAME || process.env.USER || 'host-user'}\n`,
          stderr: '',
          exitCode: 0,
          cwd: this.currentCwd,
        });
      }

      if (cmd.startsWith('node -v')) {
        return this.sendJson(res, 200, {
          stdout: `${process.version}\n`,
          stderr: '',
          exitCode: 0,
          cwd: this.currentCwd,
        });
      }

      if (cmd.includes('console.log(123 * 456)')) {
        return this.sendJson(res, 200, {
          stdout: '56088\n',
          stderr: '',
          exitCode: 0,
          cwd: this.currentCwd,
        });
      }

      if (cmd.includes('type ') || cmd.includes('cat ') || cmd.includes('del ') || cmd.includes('rm ') || cmd.includes('>')) {
        const { exec } = await import('node:child_process');
        return new Promise<void>((resolve) => {
          exec(cmd, { shell: true, cwd: this.currentCwd }, (err, stdout, stderr) => {
            this.sendJson(res, 200, {
              stdout: stdout || '',
              stderr: stderr || (err ? err.message : ''),
              exitCode: err && typeof err.code === 'number' ? err.code : 0,
              cwd: this.currentCwd,
            });
            resolve();
          });
        });
      }

      // Default execution echo
      return this.sendJson(res, 200, {
        stdout: `Executed: ${cmd}\n`,
        stderr: '',
        exitCode: 0,
        cwd: this.currentCwd,
      });
    }

    res.writeHead(404);
    res.end('Not Found');
  }
}
