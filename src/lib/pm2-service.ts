import { execFile } from "child_process";
import { promisify } from "util";
import { getActivePorts } from "./ports-service";

const execFileAsync = promisify(execFile);

export interface PM2Process {
  id: number | string;
  name: string;
  pid: number;
  status: "online" | "stopped" | "errored";
  mode: "fork" | "cluster";
  cpu: number; // percentage
  memory: number; // bytes
  uptime: number; // timestamp
  restarts: number;
  ports?: number[];
}

export interface PM2Summary {
  total: number;
  online: number;
  stopped: number;
  totalMemoryBytes: number;
  avgCpuPercent: number;
}

export interface PM2ListResponse {
  success: boolean;
  mode: "real" | "mock";
  timestamp: number;
  summary: PM2Summary;
  processes: PM2Process[];
}

export interface PM2ActionResponse {
  success: boolean;
  mode: "real" | "mock";
  message: string;
  error?: string;
  statusCode?: number;
}

const INITIAL_MOCK_PROCESSES: PM2Process[] = [
  {
    id: 0,
    name: "pmmanager-web",
    pid: 10420,
    status: "online",
    mode: "fork",
    cpu: 2.1,
    memory: 45 * 1024 * 1024,
    uptime: Date.now() - 18000000,
    restarts: 0,
  },
  {
    id: 1,
    name: "web-app",
    pid: 10421,
    status: "online",
    mode: "cluster",
    cpu: 2.1,
    memory: 48 * 1024 * 1024,
    uptime: Date.now() - 14400000, // 4 hours ago
    restarts: 0,
  },
  {
    id: 2,
    name: "api-server",
    pid: 10422,
    status: "online",
    mode: "fork",
    cpu: 1.4,
    memory: 64 * 1024 * 1024,
    uptime: Date.now() - 7200000, // 2 hours ago
    restarts: 1,
  },
  {
    id: 3,
    name: "worker",
    pid: 0,
    status: "stopped",
    mode: "fork",
    cpu: 0,
    memory: 0,
    uptime: 0,
    restarts: 3,
  },
];

declare global {
  var __pm2MockProcesses: PM2Process[] | undefined;
}

/**
 * Retrieves the persistent in-memory mock PM2 processes.
 */
export function getMockProcesses(): PM2Process[] {
  if (!globalThis.__pm2MockProcesses) {
    globalThis.__pm2MockProcesses = INITIAL_MOCK_PROCESSES.map((p) => ({ ...p }));
  }
  return globalThis.__pm2MockProcesses;
}

/**
 * Calculates summary metrics across processes.
 */
export function calculatePM2Summary(processes: PM2Process[]): PM2Summary {
  const total = processes.length;
  const online = processes.filter((p) => p.status === "online").length;
  const stopped = processes.filter((p) => p.status === "stopped").length;
  const totalMemoryBytes = processes.reduce((acc, p) => acc + (p.memory || 0), 0);
  const avgCpuPercent =
    total > 0
      ? Number((processes.reduce((acc, p) => acc + (p.cpu || 0), 0) / total).toFixed(1))
      : 0;

  return {
    total,
    online,
    stopped,
    totalMemoryBytes,
    avgCpuPercent,
  };
}

/**
 * Applies realistic metric jitter to mock processes:
 * CPU: ±1.5%, Memory: ±2MB.
 * For stopped processes, CPU is strictly 0.
 */
function applyMetricJitter(procs: PM2Process[]): PM2Process[] {
  return procs.map((proc) => {
    if (proc.status === "stopped") {
      proc.cpu = 0;
      return { ...proc, cpu: 0 };
    }

    // CPU jitter: ±1.5%
    const cpuDelta = Math.random() * 3.0 - 1.5;
    let newCpu = Number((proc.cpu + cpuDelta).toFixed(1));
    if (newCpu < 0.2) newCpu = 0.5;
    if (newCpu > 25.0) newCpu = Number((proc.cpu - 1.0).toFixed(1));

    // Memory jitter: ±2MB
    const memDelta = Math.round((Math.random() * 4 - 2) * 1024 * 1024);
    const baseMem = proc.memory > 0 ? proc.memory : 32 * 1024 * 1024;
    const newMem = Math.max(16 * 1024 * 1024, baseMem + memDelta);

    proc.cpu = newCpu;
    proc.memory = newMem;

    return {
      ...proc,
      cpu: newCpu,
      memory: newMem,
    };
  });
}

/**
 * Retrieves PM2 processes with dual execution engine:
 * Attempts host CLI `pm2 jlist`, and falls back to resilient mock with jitter.
 */
export async function getPM2Processes(): Promise<PM2ListResponse> {
  // Try fetching active ports concurrently to map them to PM2 processes
  let activePortsMap = new Map<number, number[]>();
  try {
    const portsData = await getActivePorts();
    if (portsData && portsData.ports) {
      for (const p of portsData.ports) {
        if (p.pid) {
          const existing = activePortsMap.get(p.pid) || [];
          if (!existing.includes(p.port)) {
            existing.push(p.port);
          }
          activePortsMap.set(p.pid, existing);
        }
      }
    }
  } catch (err) {
    console.warn("Failed to fetch ports for mapping:", err);
  }

  // Attempt host CLI execution
  try {
    const { stdout } = await execFileAsync("pm2", ["jlist"], {
      timeout: 3000,
      shell: process.platform === "win32",
    });

    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const processes: PM2Process[] = parsed.map((item: Record<string, unknown>) => {
        const id = (item.pm_id ?? item.name ?? 0) as number | string;
        const name = (item.name ?? `process-${id}`) as string;
        const pid = typeof item.pid === "number" ? item.pid : 0;
        const pm2Env = (item.pm2_env ?? {}) as Record<string, unknown>;
        const monit = (item.monit ?? {}) as Record<string, unknown>;

        let status: "online" | "stopped" | "errored" = "errored";
        if (pm2Env.status === "online") status = "online";
        else if (pm2Env.status === "stopped") status = "stopped";

        const mode = pm2Env.exec_mode === "cluster_mode" ? "cluster" : "fork";
        const cpu = typeof monit.cpu === "number" ? monit.cpu : 0;
        const memory = typeof monit.memory === "number" ? monit.memory : 0;
        const uptime = typeof pm2Env.pm_uptime === "number" ? pm2Env.pm_uptime : Date.now();
        const restarts = typeof pm2Env.restart_time === "number" ? pm2Env.restart_time : 0;
        
        // Match ports by PID
        const ports = activePortsMap.get(pid) || [];

        return { id, name, pid, status, mode, cpu, memory, uptime, restarts, ports };
      });

      const summary = calculatePM2Summary(processes);
      return {
        success: true,
        mode: "real",
        timestamp: Date.now(),
        summary,
        processes,
      };
    }
  } catch {
    // PM2 CLI absent or unavailable -> use resilient mock fallback
  }

  // Resilient Mock Fallback
  const mockProcs = getMockProcesses();
  const processes = applyMetricJitter(mockProcs).map(p => ({
    ...p,
    ports: activePortsMap.get(p.pid) || (p.pid === 10420 ? [3000] : p.pid === 10421 ? [3001] : p.pid === 10422 ? [8000] : []) // Mock port fallback
  }));
  const summary = calculatePM2Summary(processes);

  return {
    success: true,
    mode: "mock",
    timestamp: Date.now(),
    summary,
    processes,
  };
}

/**
 * Triggers start, stop, or restart action for a PM2 process.
 * Validates inputs, executes host CLI, and mutates process state.
 */
export async function executePM2Action(
  action: unknown,
  id: unknown
): Promise<PM2ActionResponse> {
  // Validate action
  if (
    typeof action !== "string" ||
    !["start", "stop", "restart", "flush"].includes(action)
  ) {
    return {
      success: false,
      mode: "mock",
      message: "Invalid action. Must be 'start', 'stop', 'restart', or 'flush'",
      error: "Invalid action. Must be 'start', 'stop', 'restart', or 'flush'",
      statusCode: 400,
    };
  }

  // Validate ID
  if (id === undefined || id === null || String(id).trim() === "") {
    return {
      success: false,
      mode: "mock",
      message: "Missing process ID",
      error: "Missing process ID",
      statusCode: 400,
    };
  }

  const strId = String(id).trim();

  // Sanitize against injection: alphanumeric, underscore, hyphen, and dot only
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(strId)) {
    return {
      success: false,
      mode: "mock",
      message: "Invalid process ID. Alphanumeric only",
      error: "Invalid process ID. Alphanumeric only",
      statusCode: 400,
    };
  }

  // Handle self-restarting gracefully so the API connection isn't severed instantly
  const isSelf = process.env.name === strId || strId === "server-manager" || strId === "pmmanager";
  
  // 🚨 FIX: Strip the Nexus PORT so we don't poison other apps
  const cleanEnv = { ...process.env };
  delete cleanEnv.PORT;

  if (action === "restart" && isSelf) {
    setTimeout(() => {
      execFile("pm2", ["restart", strId], { shell: process.platform === "win32", env: cleanEnv }, (error) => {
        if (error) console.error(`[PM2 CLI] Failed to self-restart: ${error.message}`);
      });
    }, 1500); // 1.5s delay to allow the HTTP response to be fully sent
    
    return {
      success: true,
      mode: "real",
      message: `Self-restart initiated. The dashboard will be back online in a few seconds.`,
    };
  }

  // Attempt host CLI execution
  let cliExecuted = false;
  let cliError = "";
  try {
    await execFileAsync("pm2", [action, strId], {
      timeout: 15000,
      shell: process.platform === "win32",
      env: cleanEnv,
    });
    cliExecuted = true;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    cliError = errorMsg;
    console.log(`[PM2 CLI] execFile pm2 ${action} ${strId} attempt: ${errorMsg}`);
  }

  // Mutate mock process state
  const mockProcs = getMockProcesses();
  const proc = mockProcs.find(
    (p) => String(p.id) === strId || p.name === strId
  );

  // If host CLI failed and process does not exist in mock store -> 404 or 500
  if (!cliExecuted && !proc) {
    return {
      success: false,
      mode: "mock",
      message: `Process ${strId} failed to ${action}: ${cliError}`,
      error: `Process ${strId} failed to ${action}: ${cliError}`,
      statusCode: 500,
    };
  }

  if (proc) {
    if (action === "stop") {
      proc.status = "stopped";
      proc.cpu = 0;
    } else if (action === "start") {
      proc.status = "online";
      proc.cpu = 2.0;
      if (proc.memory === 0) {
        proc.memory = 45 * 1024 * 1024;
      }
      proc.uptime = Date.now();
    } else if (action === "restart") {
      proc.status = "online";
      proc.restarts += 1;
      proc.uptime = Date.now();
      proc.cpu = 2.4;
      if (proc.memory === 0) {
        proc.memory = 45 * 1024 * 1024;
      }
    }
  }

  return {
    success: true,
    mode: cliExecuted ? "real" : "mock",
    message: `Process ${strId} ${action} executed`,
  };
}
export async function getPM2Logs(appName: string, lines: number = 15): Promise<string> {
  return new Promise((resolve) => {
    const { exec } = require("child_process");
    
    // 🚨 FIX: Strip the Nexus PORT so we don't poison other apps
    const cleanEnv = { ...process.env };
    delete cleanEnv.PORT;

    exec(`pm2 logs ${appName} --lines ${lines} --nostream`, { env: cleanEnv }, (error: any, stdout: string, stderr: string) => {
      if (error) { resolve('Error fetching logs: ' + error.message); return; }
      resolve(stdout || stderr || 'No logs found.');
    });
  });
}
