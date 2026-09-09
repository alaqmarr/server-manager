import {
  getUptimeMonitors,
  getUptimeMonitorById,
  recordUptimeCheck,
  recalculateMonitorSLA,
  UptimeCheckRecord,
  UptimeMonitorRecord,
} from "./db";

declare global {
  var __uptimeWorkerActive: boolean | undefined;
  var __uptimeWorkerInterval: NodeJS.Timeout | undefined;
}

const CHECK_TICK_INTERVAL_MS = 30000; // Check loop runs every 30 seconds
const PING_TIMEOUT_MS = 10000; // 10s AbortController timeout

/**
 * Checks whether the background uptime worker is currently active.
 */
export function isUptimeWorkerActive(): boolean {
  return Boolean(globalThis.__uptimeWorkerActive);
}

/**
 * Pings a target URL via HTTP/HTTPS with AbortController timeout.
 * UP: HTTP status in [200..399].
 * DOWN: Status outside [200..399], network error, or timeout.
 */
export async function pingUrl(
  url: string,
  timeoutMs: number = PING_TIMEOUT_MS
): Promise<{
  status: "UP" | "DOWN";
  statusCode: number | null;
  responseTime: number;
  error: string | null;
}> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Nexus-Uptime-Monitor/1.0",
        Accept: "*/*",
      },
    });

    clearTimeout(timeoutId);
    const responseTime = Math.max(1, Date.now() - startTime);
    const isUp = res.status >= 200 && res.status < 400;

    return {
      status: isUp ? "UP" : "DOWN",
      statusCode: res.status,
      responseTime,
      error: isUp ? null : `HTTP status ${res.status}`,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const responseTime = Math.max(1, Date.now() - startTime);
    const isTimeout = err.name === "AbortError";
    const errorMessage = isTimeout
      ? "Request timed out (10s)"
      : err.message || "Network error";

    return {
      status: "DOWN",
      statusCode: null,
      responseTime,
      error: errorMessage,
    };
  }
}

/**
 * Executes an immediate health check ping for a monitor by ID,
 * records the check result in SQLite, updates the monitor SLA, and returns the check record.
 */
export async function performUptimeCheck(
  monitorId: number
): Promise<UptimeCheckRecord> {
  const monitor = getUptimeMonitorById(monitorId);
  if (!monitor) {
    throw new Error(`Monitor with ID ${monitorId} not found`);
  }

  const pingResult = await pingUrl(monitor.url);

  const checkRecord = recordUptimeCheck({
    monitorId,
    status: pingResult.status,
    statusCode: pingResult.statusCode,
    responseTime: pingResult.responseTime,
    error: pingResult.error,
  });

  recalculateMonitorSLA(monitorId);

  return checkRecord;
}

/**
 * Evaluates all monitors and triggers health pings for any whose interval has expired.
 */
export async function pollDueMonitors(): Promise<void> {
  try {
    const monitors = getUptimeMonitors();
    const now = Date.now();

    for (const monitor of monitors) {
      const intervalMs = (monitor.intervalSeconds || 60) * 1000;
      const lastCheckTime = monitor.lastCheck
        ? new Date(monitor.lastCheck).getTime()
        : 0;

      if (now - lastCheckTime >= intervalMs) {
        performUptimeCheck(monitor.id).catch((err) =>
          console.error(`Error checking monitor ${monitor.id} (${monitor.name}):`, err)
        );
      }
    }
  } catch (err) {
    console.error("Error polling uptime monitors:", err);
  }
}

/**
 * Starts the background uptime monitoring service.
 * Guarded against multiple instances via globalThis.__uptimeWorkerActive.
 */
export function startUptimeWorker(): void {
  if (globalThis.__uptimeWorkerActive) {
    return;
  }

  globalThis.__uptimeWorkerActive = true;

  // Poll due monitors on boot
  pollDueMonitors().catch((err) =>
    console.error("Initial uptime poll failed:", err)
  );

  // Periodic poll tick
  const interval = setInterval(() => {
    pollDueMonitors().catch((err) =>
      console.error("Uptime polling tick failed:", err)
    );
  }, CHECK_TICK_INTERVAL_MS);

  if (typeof interval.unref === "function") {
    interval.unref(); // Prevent blocking process termination
  }

  globalThis.__uptimeWorkerInterval = interval;
}

/**
 * Stops the background uptime monitoring worker.
 */
export function stopUptimeWorker(): void {
  if (globalThis.__uptimeWorkerInterval) {
    clearInterval(globalThis.__uptimeWorkerInterval);
    globalThis.__uptimeWorkerInterval = undefined;
  }
  globalThis.__uptimeWorkerActive = false;
}
