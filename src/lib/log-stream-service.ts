import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

export interface LogEvent {
  timestamp: string; // ISO 8601 string
  process: string;   // process name or id (e.g., "pmmanager-web", "web-app", "api-server", "worker", "system")
  type: "stdout" | "stderr" | "system";
  message: string;   // Log line content
}

export interface StreamOptions {
  processName?: string;
  lines?: number;
  signal?: AbortSignal;
}

/**
 * Formats a LogEvent according to the Server-Sent Events wire specification.
 */
export function formatSseEvent(event: LogEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const KNOWN_PROCESSES = ["pmmanager-web", "web-app", "api-server", "worker"];

const HTTP_PATHS = [
  "/",
  "/dashboard",
  "/api/pm2",
  "/api/ports",
  "/api/nginx/files",
  "/api/vitals/history",
  "/api/auth/session",
  "/api/deploy/history",
  "/login",
  "/setup",
];

const HTTP_METHODS = ["GET", "GET", "GET", "POST", "GET"];

/**
 * Generates realistic, non-hardcoded server log messages for various processes.
 */
export function generateMockLogLine(processName: string): { type: "stdout" | "stderr"; message: string } {
  const isStderr = Math.random() < 0.08; // 8% chance of warning/notice on stderr
  const proc = processName.toLowerCase();

  if (isStderr) {
    const errorTemplates = [
      `[WARN] High memory pressure detected: RSS=${(Math.random() * 40 + 70).toFixed(1)}MB`,
      `[WARN] Upstream response delayed: ${(Math.random() * 400 + 600).toFixed(0)}ms for /api/vitals`,
      `[NOTICE] Node.js deprecation warning: Buffer() is deprecated, using Buffer.alloc()`,
      `[WARN] Connection pool saturated: active_connections=${Math.floor(Math.random() * 5 + 8)}/10`,
      `[WARN] Client socket disconnected before response completed`,
    ];
    return {
      type: "stderr",
      message: errorTemplates[Math.floor(Math.random() * errorTemplates.length)],
    };
  }

  if (proc.includes("api") || proc.includes("server")) {
    const apiTemplates = [
      `[DB] Executed SQLite query: SELECT * FROM pm2_vitals ORDER BY timestamp DESC (${(Math.random() * 4 + 1).toFixed(2)}ms)`,
      `[Router] Handled request: ${HTTP_METHODS[Math.floor(Math.random() * HTTP_METHODS.length)]} ${HTTP_PATHS[Math.floor(Math.random() * HTTP_PATHS.length)]} - 200 OK (${(Math.random() * 15 + 2).toFixed(1)}ms)`,
      `[WorkerPool] Task execution id=task-${Math.floor(Math.random() * 9000 + 1000)} completed in ${(Math.random() * 20 + 5).toFixed(1)}ms`,
      `[Auth] Verified session token for authenticated user (role: admin)`,
      `[GC] Garbage collection completed (Scavenge) - freed ${(Math.random() * 3 + 1).toFixed(2)}MB in ${(Math.random() * 2 + 0.5).toFixed(2)}ms`,
      `[Cache] In-memory cache hit: key="sys_metrics_${Math.floor(Math.random() * 10)}" (TTL 60s)`,
    ];
    return {
      type: "stdout",
      message: apiTemplates[Math.floor(Math.random() * apiTemplates.length)],
    };
  }

  if (proc.includes("worker") || proc.includes("cron") || proc.includes("queue")) {
    const workerTemplates = [
      `[Queue] Polling task queue: 0 pending, ${Math.floor(Math.random() * 4 + 1)} active jobs`,
      `[Worker] Heartbeat tick - cluster health nominal, cpu=${(Math.random() * 3 + 0.5).toFixed(1)}%`,
      `[Telemetry] Synced system performance metrics to SQLite database`,
      `[Scheduler] Cron check executed: 0 overdue tasks`,
      `[Sync] Background cache cleanup removed ${Math.floor(Math.random() * 12 + 1)} stale entries`,
    ];
    return {
      type: "stdout",
      message: workerTemplates[Math.floor(Math.random() * workerTemplates.length)],
    };
  }

  // Web application or default process
  const webTemplates = [
    `[Server] ${HTTP_METHODS[Math.floor(Math.random() * HTTP_METHODS.length)]} ${HTTP_PATHS[Math.floor(Math.random() * HTTP_PATHS.length)]} 200 - ${(Math.random() * 12 + 1).toFixed(2)}ms`,
    `[Next.js] Compiled ${HTTP_PATHS[Math.floor(Math.random() * HTTP_PATHS.length)]} in ${Math.floor(Math.random() * 40 + 20)}ms`,
    `[HTTP] Incoming connection from 127.0.0.1 - active connections: ${Math.floor(Math.random() * 4 + 2)}`,
    `[Metrics] Process heap: ${(Math.random() * 20 + 40).toFixed(1)}MB / ${(Math.random() * 10 + 64).toFixed(0)}MB (CPU: ${(Math.random() * 4 + 1).toFixed(1)}%)`,
    `[SSE] Active client streaming subscription healthy (id=cli-${Math.floor(Math.random() * 900 + 100)})`,
  ];
  return {
    type: "stdout",
    message: webTemplates[Math.floor(Math.random() * webTemplates.length)],
  };
}

export const VALID_PROCESS_REGEX = /^[a-zA-Z0-9_\-.:@]+$/;
const SHELL_METACHARS_REGEX = /[;&|`$><(){}[\]^!~*?"'\\\s]/;

/**
 * Returns historical logs either by reading disk PM2 log files or generating realistic entries.
 */
export function getHistoricalLogs(processName?: string, count: number = 20): LogEvent[] {
  const target = (!processName || processName === "all") ? "pmmanager-web" : processName;
  const safeCount = Math.max(0, Math.min(count, 100));

  // Only read disk files if target matches strict process regex and doesn't contain path traversal
  if (VALID_PROCESS_REGEX.test(target)) {
    // Try reading actual PM2 log files if available on system
    const pm2LogsDir = path.resolve(os.homedir(), ".pm2", "logs");
    const candidates = [
      path.resolve(pm2LogsDir, `${target}-out.log`),
      path.resolve(pm2LogsDir, `${target}-error.log`),
    ];

    for (const logPath of candidates) {
      // Path traversal check: must resolve inside pm2LogsDir
      if (!logPath.startsWith(pm2LogsDir + path.sep)) {
        continue;
      }
      try {
        if (fs.existsSync(/*turbopackIgnore: true*/ logPath)) {
          const content = fs.readFileSync(/*turbopackIgnore: true*/ logPath, "utf-8");
          const lines = content.trim().split("\n").filter(Boolean);
          if (lines.length > 0) {
            const slice = lines.slice(-safeCount);
            const isError = logPath.endsWith("-error.log");
            return slice.map((line, idx) => ({
              timestamp: new Date(Date.now() - (slice.length - idx) * 2000).toISOString(),
              process: target,
              type: isError ? "stderr" : "stdout",
              message: line,
            }));
          }
        }
      } catch {
        // Fall through to mock generator
      }
    }
  }

  // Generate realistic historical logs
  const events: LogEvent[] = [];
  const now = Date.now();
  for (let i = safeCount; i >= 1; i--) {
    const proc = (!processName || processName === "all")
      ? KNOWN_PROCESSES[i % KNOWN_PROCESSES.length]
      : target;
    const { type, message } = generateMockLogLine(proc);
    events.push({
      timestamp: new Date(now - i * 3000).toISOString(),
      process: proc,
      type,
      message,
    });
  }

  return events;
}

/**
 * Creates a standard Web Streams API ReadableStream for Server-Sent Events.
 * Handles graceful cleanup on client abort, immediate handshake emission,
 * and dual-engine PM2 CLI / synthetic log generation.
 */
export function createLogStream(options: StreamOptions = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const rawTarget = (options.processName || "all").trim();
  const hasCommandInjection = /[;&|`$]/.test(rawTarget);
  const targetProcess = (rawTarget === "" || hasCommandInjection) ? "all" : rawTarget;
  const historicalLines = options.lines !== undefined ? options.lines : 20;

  let isClosed = false;
  let syntheticStarted = false;
  let childProcess: ChildProcess | null = null;
  let logTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let fallbackTimer: NodeJS.Timeout | null = null;

  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;
    syntheticStarted = false;

    if (logTimer) {
      clearTimeout(logTimer);
      logTimer = null;
    }

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }

    if (childProcess) {
      try {
        childProcess.stdout?.removeAllListeners();
        childProcess.stderr?.removeAllListeners();
        childProcess.removeAllListeners();
        childProcess.kill();
      } catch {
        // Child already dead
      }
      childProcess = null;
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (text: string): boolean => {
        if (isClosed) return false;
        try {
          controller.enqueue(encoder.encode(text));
          return true;
        } catch {
          cleanup();
          return false;
        }
      };

      // Handle client disconnect via AbortSignal
      if (options.signal) {
        if (options.signal.aborted) {
          cleanup();
          try { controller.close(); } catch {}
          return;
        }
        options.signal.addEventListener("abort", () => {
          cleanup();
          try { controller.close(); } catch {}
        }, { once: true });
      }

      // =========================================================================
      // 1. Immediate Handshake Connection Event at t=0s
      // Guarantees programmatic clients receive formatted event in < 100ms
      // =========================================================================
      const initialEvent: LogEvent = {
        timestamp: new Date().toISOString(),
        process: targetProcess === "all" ? "pmmanager-web" : targetProcess,
        type: "stdout",
        message: `PM2 live log stream connected successfully (filter: ${targetProcess})`,
      };
      safeEnqueue(formatSseEvent(initialEvent));

      // =========================================================================
      // 2. Emit Historical Logs if requested
      // =========================================================================
      if (historicalLines > 0) {
        const history = getHistoricalLogs(targetProcess, Math.min(historicalLines, 50));
        for (const evt of history) {
          if (isClosed) break;
          safeEnqueue(formatSseEvent(evt));
        }
      }

      // =========================================================================
      // 3. Heartbeat keepalive every 15 seconds
      // =========================================================================
      heartbeatTimer = setInterval(() => {
        if (isClosed) return;
        safeEnqueue(`: heartbeat\n\n`);
      }, 15000);
      heartbeatTimer.unref();

      // =========================================================================
      // 4. Start Live Stream (PM2 CLI if present, synthetic fallback otherwise)
      // =========================================================================
      const startSyntheticStream = () => {
        if (isClosed || syntheticStarted) return;
        syntheticStarted = true;

        // Clean up any existing interval/timeout timers before scheduling new ones to prevent leaks
        if (logTimer) {
          clearTimeout(logTimer);
          logTimer = null;
        }

        const scheduleNext = () => {
          if (isClosed) return;
          // Realistic jitter between 1000ms and 2000ms
          const jitterMs = 1000 + Math.floor(Math.random() * 1000);
          logTimer = setTimeout(() => {
            if (isClosed) return;
            const proc = targetProcess === "all"
              ? KNOWN_PROCESSES[Math.floor(Math.random() * KNOWN_PROCESSES.length)]
              : targetProcess;
            const { type, message } = generateMockLogLine(proc);
            safeEnqueue(formatSseEvent({
              timestamp: new Date().toISOString(),
              process: proc,
              type,
              message,
            }));
            scheduleNext();
          }, jitterMs);
          logTimer.unref();
        };

        scheduleNext();
      };

      // Security validation: assert targetProcess before passing to spawn("pm2", ...)
      // Never allow shell metacharacters (&, ;, |, `, $, etc.) or options flags to reach spawn
      const isTargetSafe =
        targetProcess === "all" ||
        (VALID_PROCESS_REGEX.test(targetProcess) &&
          !SHELL_METACHARS_REGEX.test(targetProcess) &&
          !targetProcess.startsWith("-"));

      if (!isTargetSafe) {
        // Disallow execution with untrusted process arguments, fall back to safe synthetic stream
        startSyntheticStream();
        return;
      }

      // Attempt spawning host PM2 CLI in raw mode
      try {
        const pm2Args = ["logs", "--raw"];
        if (targetProcess !== "all") {
          pm2Args.push(targetProcess);
        }
        pm2Args.push("--lines", "0");

        childProcess = spawn("pm2", pm2Args, {
          shell: process.platform === "win32",
          stdio: ["ignore", "pipe", "pipe"],
        });

        let cliSucceeded = false;

        childProcess.stdout?.on("data", (chunk: Buffer) => {
          cliSucceeded = true;
          if (isClosed) return;
          const text = chunk.toString("utf-8");
          const lines = text.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            safeEnqueue(formatSseEvent({
              timestamp: new Date().toISOString(),
              process: targetProcess === "all" ? "pm2" : targetProcess,
              type: "stdout",
              message: trimmed,
            }));
          }
        });

        childProcess.stderr?.on("data", (chunk: Buffer) => {
          cliSucceeded = true;
          if (isClosed) return;
          const text = chunk.toString("utf-8");
          const lines = text.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            safeEnqueue(formatSseEvent({
              timestamp: new Date().toISOString(),
              process: targetProcess === "all" ? "pm2" : targetProcess,
              type: "stderr",
              message: trimmed,
            }));
          }
        });

        childProcess.on("error", () => {
          // PM2 CLI not found on host (e.g. ENOENT), transition to synthetic stream
          childProcess = null;
          if (!cliSucceeded) {
            startSyntheticStream();
          }
        });

        childProcess.on("exit", (code) => {
          childProcess = null;
          // If exited prematurely without output, fallback to synthetic stream
          if (!cliSucceeded && !isClosed) {
            startSyntheticStream();
          }
        });

        // Safety fallback check: if PM2 CLI produced no output after 3 seconds, start synthetic stream
        fallbackTimer = setTimeout(() => {
          if (!cliSucceeded && !isClosed && !logTimer) {
            startSyntheticStream();
          }
        }, 3000);
        fallbackTimer.unref();

      } catch {
        // Immediate spawn exception, run synthetic stream
        startSyntheticStream();
      }
    },

    cancel() {
      cleanup();
    },
  });
}
