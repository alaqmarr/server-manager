/**
 * E2E HTTP Test Client
 * Handles cookie jar persistence (NextAuth v5 session cookies), base URL routing,
 * redirect inspections, and JSON/Form payload handling.
 */

export class TestClient {
  private cookies: Map<string, string> = new Map();
  public baseUrl: string;

  constructor(baseUrl: string = process.env.TEST_SERVER_URL || process.env.BASE_URL || 'http://localhost:3000') {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Clone the client to create an isolated session with independent cookies
   */
  public clone(): TestClient {
    const next = new TestClient(this.baseUrl);
    for (const [k, v] of this.cookies.entries()) {
      next.cookies.set(k, v);
    }
    return next;
  }

  /**
   * Create an unauthenticated client sharing the same baseUrl
   */
  public createAnonymousClient(): TestClient {
    return new TestClient(this.baseUrl);
  }

  /**
   * Clear all stored session and csrf cookies
   */
  public clearCookies(): void {
    this.cookies.clear();
  }

  /**
   * Manually set a cookie key/value (useful for tamper/boundary testing)
   */
  public setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  /**
   * Get all currently stored cookies as a single header string
   */
  public getCookieHeader(): string {
    const entries: string[] = [];
    for (const [k, v] of this.cookies.entries()) {
      entries.push(`${k}=${v}`);
    }
    return entries.join('; ');
  }

  /**
   * Ingest Set-Cookie headers from fetch Response
   */
  public ingestCookies(res: Response): void {
    const rawSetCookies: string[] = [];

    // Node 20+ supports getSetCookie()
    if (typeof (res.headers as any).getSetCookie === 'function') {
      const list = (res.headers as any).getSetCookie();
      if (Array.isArray(list)) {
        rawSetCookies.push(...list);
      }
    } else {
      const single = res.headers.get('set-cookie');
      if (single) {
        rawSetCookies.push(single);
      }
    }

    for (const raw of rawSetCookies) {
      // Split cookie string by semicolons; first part is name=value
      const parts = raw.split(';');
      const firstPart = parts[0]?.trim();
      if (firstPart) {
        const eqIdx = firstPart.indexOf('=');
        if (eqIdx > 0) {
          const name = firstPart.substring(0, eqIdx).trim();
          const val = firstPart.substring(eqIdx + 1).trim();
          if (val === '' || val === 'deleted' || raw.includes('Max-Age=0')) {
            this.cookies.delete(name);
          } else {
            this.cookies.set(name, val);
          }
        }
      }
    }
  }

  /**
   * Execute raw fetch against this client's baseUrl with automatic cookie tracking
   */
  public async fetch(
    path: string,
    options: RequestInit & { followRedirects?: boolean } = {}
  ): Promise<Response> {
    const url = path.startsWith('http://') || path.startsWith('https://')
      ? path
      : `${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`;

    const headers = new Headers(options.headers || {});

    // Attach existing cookies if not explicitly overridden
    if (!headers.has('cookie')) {
      const cookieStr = this.getCookieHeader();
      if (cookieStr) {
        headers.set('cookie', cookieStr);
      }
    }

    const redirectMode = options.followRedirects === false ? 'manual' : (options.redirect || 'manual');

    const res = await fetch(url, {
      ...options,
      headers,
      redirect: redirectMode,
    });

    this.ingestCookies(res);
    return res;
  }

  /**
   * Helper to perform GET and optionally parse JSON
   */
  public async get<T = any>(
    path: string,
    options: RequestInit = {}
  ): Promise<{ status: number; ok: boolean; data: T; response: Response }> {
    const res = await this.fetch(path, { ...options, method: 'GET' });
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      // return as text if not json
    }
    return { status: res.status, ok: res.ok, data, response: res };
  }

  /**
   * Helper to perform POST with JSON payload
   */
  public async post<T = any>(
    path: string,
    body: any,
    options: RequestInit = {}
  ): Promise<{ status: number; ok: boolean; data: T; response: Response }> {
    const headers = new Headers(options.headers || {});
    let bodyContent: BodyInit;

    if (typeof body === 'string') {
      bodyContent = body;
    } else {
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      bodyContent = JSON.stringify(body);
    }

    const res = await this.fetch(path, {
      ...options,
      method: 'POST',
      headers,
      body: bodyContent,
    });

    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      // return as text
    }

    return { status: res.status, ok: res.ok, data, response: res };
  }

  /**
   * Request NextAuth CSRF Token from /api/auth/csrf
   */
  public async getCsrfToken(): Promise<string> {
    const res = await this.get<{ csrfToken: string }>('/api/auth/csrf');
    if (res.data && res.data.csrfToken) {
      return res.data.csrfToken;
    }
    // Fallback: search for csrfToken in body
    if (typeof res.data === 'string') {
      const match = res.data.match(/"csrfToken":\s*"([^"]+)"/);
      if (match) return match[1];
    }
    return '';
  }

  /**
   * Complete NextAuth Credentials login handshake.
   * Returns true if session cookie obtained or login succeeded.
   */
  public async login(username: string, password: string): Promise<{ success: boolean; status: number; sessionCookie?: string; error?: string }> {
    const csrfToken = await this.getCsrfToken();

    // NextAuth Credentials endpoint expects form-urlencoded or JSON with csrfToken
    const formParams = new URLSearchParams();
    formParams.set('csrfToken', csrfToken);
    formParams.set('username', username);
    formParams.set('password', password);
    formParams.set('redirect', 'false');
    formParams.set('json', 'true');

    const res = await this.fetch('/api/auth/callback/credentials', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: formParams.toString(),
      redirect: 'manual',
    });

    // Extract any session cookie
    let foundSession = false;
    let sessionCookieName = '';
    for (const [key] of this.cookies.entries()) {
      if (key.includes('session-token')) {
        foundSession = true;
        sessionCookieName = key;
        break;
      }
    }

    // NextAuth v5 may return 200 with JSON { url: ... } or 302/307 redirect
    const isSuccessStatus = res.status === 200 || res.status === 302 || res.status === 307;
    const location = res.headers.get('location') || '';
    const hasError = location.includes('error=');

    if ((foundSession || isSuccessStatus) && !hasError) {
      return { success: true, status: res.status, sessionCookie: sessionCookieName };
    }

    return {
      success: false,
      status: res.status,
      error: hasError ? location : `Login rejected with HTTP ${res.status}`,
    };
  }

  /**
   * One-time Admin Setup Helper
   */
  public async setupAdmin(username: string, password: string): Promise<{ status: number; ok: boolean; data: any }> {
    return this.post('/api/setup', { username, password });
  }

  /**
   * Helper to perform DELETE with optional JSON payload
   */
  public async delete<T = any>(
    path: string,
    body?: any,
    options: RequestInit = {}
  ): Promise<{ status: number; ok: boolean; data: T; response: Response }> {
    const headers = new Headers(options.headers || {});
    let bodyContent: BodyInit | undefined = undefined;

    if (body !== undefined && body !== null) {
      if (typeof body === 'string') {
        bodyContent = body;
      } else {
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/json');
        }
        bodyContent = JSON.stringify(body);
      }
    }

    const res = await this.fetch(path, {
      ...options,
      method: 'DELETE',
      headers,
      body: bodyContent,
    });

    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      // return as text
    }

    return { status: res.status, ok: res.ok, data, response: res };
  }

  /**
   * Ensure a developer user exists in SQLite database (if accessible directly)
   */
  public async ensureDeveloperUser(username = 'developer', password = 'password123'): Promise<boolean> {
    try {
      const Database = (await import('better-sqlite3')).default;
      const bcrypt = await import('bcrypt');
      const path = await import('path');
      const fs = await import('fs');
      const dbPath = path.join(process.cwd(), 'data.db');
      if (fs.existsSync(dbPath)) {
        const db = new Database(dbPath);
        const existing = db.prepare('SELECT id, role FROM users WHERE username = ? COLLATE NOCASE').get(username) as any;
        if (!existing) {
          const hash = bcrypt.hashSync(password, 10);
          db.prepare("INSERT INTO users (username, passwordHash, role) VALUES (?, ?, 'developer')").run(username, hash);
        } else if (existing.role !== 'developer') {
          db.prepare("UPDATE users SET role = 'developer' WHERE id = ?").run(existing.id);
        }
        db.close();
        return true;
      }
    } catch {
      // In-process mock or restricted DB access fallback
    }
    return false;
  }

  /**
   * Create an authenticated Developer client
   */
  public async createDeveloperClient(username = 'developer', password = 'password123'): Promise<TestClient> {
    await this.ensureDeveloperUser(username, password);
    const devClient = this.createAnonymousClient();
    await devClient.login(username, password);
    return devClient;
  }

  /**
   * Connect to Server-Sent Events (SSE) endpoint and receive parsed log events
   */
  public async connectSse(
    path: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<{ firstEvent: any; events: any[]; status: number; headers: Headers; abort: () => void }> {
    const timeoutMs = options.timeoutMs ?? 10000;
    const controller = new AbortController();
    const abort = () => {
      try {
        controller.abort();
      } catch {}
    };

    const timeoutId = setTimeout(() => {
      abort();
    }, timeoutMs);

    const url = path.startsWith('http://') || path.startsWith('https://')
      ? path
      : `${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`;

    const headers = new Headers();
    headers.set('accept', 'text/event-stream');
    const cookieStr = this.getCookieHeader();
    if (cookieStr) {
      headers.set('cookie', cookieStr);
    }

    const events: any[] = [];

    try {
      const res = await fetch(url, {
        headers,
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        clearTimeout(timeoutId);
        return {
          firstEvent: null,
          events: [],
          status: res.status,
          headers: res.headers,
          abort,
        };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const block of parts) {
          const lines = block.split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const rawData = line.substring(5).trim();
              let parsed: any = rawData;
              try {
                parsed = JSON.parse(rawData);
              } catch {
                // leave as string
              }
              events.push(parsed);
              if (events.length >= 1) {
                clearTimeout(timeoutId);
                abort();
                return {
                  firstEvent: events[0],
                  events,
                  status: res.status,
                  headers: res.headers,
                  abort,
                };
              }
            }
          }
        }
      }

      clearTimeout(timeoutId);
      return {
        firstEvent: events[0] || null,
        events,
        status: res.status,
        headers: res.headers,
        abort,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (events.length > 0) {
        return {
          firstEvent: events[0],
          events,
          status: 200,
          headers: new Headers(),
          abort,
        };
      }
      throw err;
    }
  }
}

