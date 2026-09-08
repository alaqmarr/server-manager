import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface PortEntry {
  port: number;
  protocol: "TCP" | "UDP";
  address: string;
  process: string;
  pid: number;
  state: string;
}

export interface PortsResponse {
  success: boolean;
  mode: "real" | "mock";
  ports: PortEntry[];
}

export const KNOWN_PORTS: Record<number, string> = {
  20: "FTP Data",
  21: "FTP Control",
  22: "sshd",
  25: "SMTP",
  53: "DNS",
  80: "nginx",
  110: "POP3",
  143: "IMAP",
  443: "nginx",
  465: "SMTPS",
  587: "SMTP Submission",
  993: "IMAPS",
  995: "POP3S",
  1433: "MSSQL",
  1521: "Oracle DB",
  3000: "pmmanager / node",
  3306: "mysql",
  5432: "postgresql",
  6379: "redis-server",
  8000: "http-dev",
  8080: "http-alt",
  8443: "https-alt",
  9000: "php-fpm",
  27017: "mongodb",
};

export const SIMULATED_PORTS: PortEntry[] = [
  { port: 22, protocol: "TCP", address: "0.0.0.0", process: "sshd", pid: 742, state: "LISTEN" },
  { port: 80, protocol: "TCP", address: "0.0.0.0", process: "nginx", pid: 1042, state: "LISTEN" },
  { port: 443, protocol: "TCP", address: "0.0.0.0", process: "nginx", pid: 1042, state: "LISTEN" },
  { port: 3000, protocol: "TCP", address: "127.0.0.1", process: "node (pmmanager)", pid: 12345, state: "LISTEN" },
  { port: 5432, protocol: "TCP", address: "127.0.0.1", process: "postgresql", pid: 5432, state: "LISTEN" },
  { port: 6379, protocol: "TCP", address: "127.0.0.1", process: "redis-server", pid: 6379, state: "LISTEN" },
];

declare global {
  var __cachedPortsData: { timestamp: number; response: PortsResponse } | undefined;
}

const CACHE_TTL_MS = 3000; // 3 seconds TTL for stability across rapid consecutive calls

/**
 * Fetch process name mapping by PID on Windows using tasklist.
 */
async function getWindowsProcessMap(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const { stdout } = await execAsync("tasklist /fo csv /nh", { timeout: 3000 });
    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
      // Line format: "Image Name","PID","Session Name","Session#","Mem Usage"
      const match = line.match(/^"([^"]+)","(\d+)"/);
      if (match) {
        const imageName = match[1].replace(/\.exe$/i, "");
        const pid = parseInt(match[2], 10);
        map.set(pid, imageName);
      }
    }
  } catch {
    // If tasklist fails, proceed without process map
  }
  return map;
}

/**
 * Discovers listening ports on Windows via netstat.
 */
async function scanWindowsPorts(): Promise<PortEntry[]> {
  const entries: PortEntry[] = [];
  const procMap = await getWindowsProcessMap();

  try {
    const { stdout } = await execAsync("netstat -ano -p tcp", { timeout: 5000 });
    const lines = stdout.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("TCP")) continue;

      const parts = trimmed.split(/\s+/);
      if (parts.length < 5) continue;

      const protocol = parts[0].toUpperCase() as "TCP" | "UDP";
      const localAddressFull = parts[1];
      const stateRaw = parts[3].toUpperCase();
      const pidStr = parts[4];

      if (stateRaw !== "LISTENING") continue;

      const lastColon = localAddressFull.lastIndexOf(":");
      if (lastColon === -1) continue;

      const address = localAddressFull.substring(0, lastColon).replace(/^\[|\]$/g, "");
      const port = parseInt(localAddressFull.substring(lastColon + 1), 10);
      const pid = parseInt(pidStr, 10) || 0;

      if (isNaN(port) || port < 1 || port > 65535) continue;

      let processName = procMap.get(pid);
      if (!processName || processName === "System" || processName.toLowerCase().includes("svchost")) {
        if (KNOWN_PORTS[port]) {
          processName = KNOWN_PORTS[port];
        } else if (!processName) {
          processName = pid === 4 ? "System" : `Process (PID ${pid})`;
        }
      } else if (KNOWN_PORTS[port] && !processName.toLowerCase().includes(KNOWN_PORTS[port].toLowerCase())) {
        processName = `${processName} (${KNOWN_PORTS[port]})`;
      }

      entries.push({
        port,
        protocol: protocol === "UDP" ? "UDP" : "TCP",
        address: address || "0.0.0.0",
        process: processName,
        pid,
        state: "LISTEN",
      });
    }
  } catch (err) {
    console.warn("netstat scan failed on Windows:", err);
  }

  return entries;
}

/**
 * Discovers listening ports on Linux/Unix via ss or netstat.
 */
async function scanLinuxPorts(): Promise<PortEntry[]> {
  const entries: PortEntry[] = [];

  // 1. Try ss -tulpn
  let commandOutput = "";
  try {
    const { stdout } = await execAsync("ss -tulpn", { timeout: 5000 });
    commandOutput = stdout;
  } catch {
    // Fallback to netstat -tulpn or netstat -ano
    try {
      const { stdout } = await execAsync("netstat -tulpn", { timeout: 5000 });
      commandOutput = stdout;
    } catch (err) {
      console.warn("ss and netstat failed on Linux:", err);
    }
  }

  if (commandOutput) {
    const lines = commandOutput.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("Netid") || trimmed.startsWith("Active")) continue;

      // Match ss line: e.g. tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=742,fd=3))
      const parts = trimmed.split(/\s+/);
      if (parts.length < 4) continue;

      const rawProto = parts[0].toLowerCase();
      if (!rawProto.startsWith("tcp") && !rawProto.startsWith("udp")) continue;

      const protocol: "TCP" | "UDP" = rawProto.startsWith("udp") ? "UDP" : "TCP";

      let localAddrCol = "";
      let usersCol = "";

      for (let i = 1; i < parts.length; i++) {
        if (parts[i].includes(":") && !localAddrCol) {
          localAddrCol = parts[i];
        }
        if (parts[i].startsWith("users:") || parts[i].includes("pid=")) {
          usersCol = parts.slice(i).join(" ");
          break;
        }
      }

      if (!localAddrCol) continue;

      const lastColon = localAddrCol.lastIndexOf(":");
      if (lastColon === -1) continue;

      const address = localAddrCol.substring(0, lastColon).replace(/^\[|\]$/g, "") || "0.0.0.0";
      const port = parseInt(localAddrCol.substring(lastColon + 1), 10);
      if (isNaN(port) || port < 1 || port > 65535) continue;

      let pid = 0;
      let processName = "";

      if (usersCol) {
        const match = usersCol.match(/users:\(\("([^"]+)",pid=(\d+)/) || usersCol.match(/"([^"]+)",pid=(\d+)/);
        if (match) {
          processName = match[1];
          pid = parseInt(match[2], 10);
        }
      }

      if (!processName) {
        processName = KNOWN_PORTS[port] || "system";
      }

      entries.push({
        port,
        protocol,
        address: address === "*" ? "0.0.0.0" : address,
        process: processName,
        pid,
        state: "LISTEN",
      });
    }
  }

  return entries;
}

/**
 * Deduplicate and sort port entries deterministically.
 */
function normalizePortEntries(entries: PortEntry[]): PortEntry[] {
  const seen = new Set<string>();
  const unique: PortEntry[] = [];

  for (const item of entries) {
    const key = `${item.port}-${item.protocol}-${item.address}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({
        port: item.port,
        protocol: item.protocol,
        address: item.address,
        process: item.process,
        pid: item.pid,
        state: item.state,
      });
    }
  }

  return unique.sort((a, b) => a.port - b.port);
}

/**
 * Main service entry point for retrieving active open ports.
 * Queries real system network tables first, with robust fallback to simulated ports.
 */
export async function getActivePorts(forceRefresh = false): Promise<PortsResponse> {
  const now = Date.now();
  if (
    !forceRefresh &&
    globalThis.__cachedPortsData &&
    now - globalThis.__cachedPortsData.timestamp < CACHE_TTL_MS
  ) {
    return globalThis.__cachedPortsData.response;
  }

  let rawPorts: PortEntry[] = [];
  const isWindows = process.platform === "win32";

  try {
    if (isWindows) {
      rawPorts = await scanWindowsPorts();
    } else {
      rawPorts = await scanLinuxPorts();
    }
  } catch (err) {
    console.warn("Real port discovery error:", err);
  }

  let response: PortsResponse;

  if (rawPorts && rawPorts.length > 0) {
    const normalized = normalizePortEntries(rawPorts);
    response = {
      success: true,
      mode: "real",
      ports: normalized,
    };
  } else {
    // Resilient simulated fallback
    response = {
      success: true,
      mode: "mock",
      ports: normalizePortEntries(SIMULATED_PORTS),
    };
  }

  globalThis.__cachedPortsData = {
    timestamp: now,
    response,
  };

  return response;
}
