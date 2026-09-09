/**
 * Fail2Ban Security Shield Service
 *
 * Provides real CLI execution of `fail2ban-client` on Linux hosts,
 * with strict command injection prevention (shell metacharacter checks,
 * IP regex validation, jail name regex validation), and resilient mock
 * fallback for non-Linux/Windows and environments without the fail2ban daemon.
 */

import { execFile } from "node:child_process";
import util from "node:util";
import net from "node:net";

const execFileAsync = util.promisify(execFile);

/**
 * Shell metacharacters strictly forbidden to prevent OS command injection.
 * Prohibits: &, ;, |, `, $, >, <, (, ), \, !
 */
export const SHELL_METACHAR_REGEX = /[;&|`$><()\\!]/;

/**
 * Jail name validation: only alphanumeric characters, underscores, and hyphens.
 */
export const JAIL_NAME_REGEX = /^[a-zA-Z0-9_\-]+$/;

/**
 * Robust IPv4 regex: strictly matches 4 octets between 0 and 255.
 */
export const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/;

/**
 * Robust IPv6 regex: standard, compressed, and loopback representations.
 */
export const IPV6_REGEX =
  /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^[0-9a-fA-F]{1,4}::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}$|^[0-9a-fA-F]{1,4}:[0-9a-fA-F]{1,4}::(?:[0-9a-fA-F]{1,4}:){0,4}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){0,2}[0-9a-fA-F]{1,4}::(?:[0-9a-fA-F]{1,4}:){0,3}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){0,3}[0-9a-fA-F]{1,4}::(?:[0-9a-fA-F]{1,4}:){0,2}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){0,4}[0-9a-fA-F]{1,4}::[0-9a-fA-F]{1,4}:[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}::[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}::$|^::1$/;

export class Fail2BanError extends Error {
  public statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "Fail2BanError";
    this.statusCode = statusCode;
  }
}

export interface BannedIPRecord {
  ip: string;
  jail: string;
  banTime?: string;
  bannedAt?: string;
}

export interface Fail2BanStatusResult {
  success: boolean;
  mode: "real" | "mock";
  jails: string[];
  bannedList: BannedIPRecord[];
}

export interface UnbanOptions {
  jail: string;
  ip: string;
}

export interface UnbanResult {
  success: boolean;
  mode: "real" | "mock";
  message: string;
}

export interface MockFail2BanStore {
  jails: string[];
  bannedList: BannedIPRecord[];
}

declare global {
  // eslint-disable-next-line no-var
  var _mockFail2BanStore: MockFail2BanStore | undefined;
}

/**
 * Returns true if the string contains any shell metacharacters.
 */
export function hasShellMetachars(value: string): boolean {
  return SHELL_METACHAR_REGEX.test(value);
}

/**
 * Validates jail name against injection and regex constraints.
 */
export function validateJail(jail: unknown): { valid: boolean; error?: string } {
  if (jail === undefined || jail === null || typeof jail !== "string") {
    return { valid: false, error: "Missing or non-string jail parameter" };
  }
  const trimmed = jail.trim();
  if (trimmed === "") {
    return { valid: false, error: "Jail name cannot be empty" };
  }
  if (hasShellMetachars(trimmed)) {
    return {
      valid: false,
      error: "Invalid jail name. Shell metacharacters detected",
    };
  }
  if (!JAIL_NAME_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: "Jail name must contain only alphanumeric characters, underscores, and hyphens",
    };
  }
  return { valid: true };
}

/**
 * Validates IP address against injection and IPv4/IPv6 regex constraints.
 */
export function validateIp(ip: unknown): { valid: boolean; error?: string } {
  if (ip === undefined || ip === null || typeof ip !== "string") {
    return { valid: false, error: "Missing or non-string IP parameter" };
  }
  const trimmed = ip.trim();
  if (trimmed === "") {
    return { valid: false, error: "IP address cannot be empty" };
  }
  if (hasShellMetachars(trimmed)) {
    return {
      valid: false,
      error: "Invalid IP address. Malformed characters detected",
    };
  }
  const isV4 = IPV4_REGEX.test(trimmed);
  const isV6 = IPV6_REGEX.test(trimmed);
  const nodeIpType = net.isIP(trimmed);
  if ((!isV4 && !isV6) || nodeIpType === 0) {
    return {
      valid: false,
      error: "Invalid IP address format. Must be a valid IPv4 or IPv6 address",
    };
  }
  return { valid: true };
}

/**
 * Initialize or get the global mock store for resilient fallback.
 */
export function getMockStore(): MockFail2BanStore {
  if (!globalThis._mockFail2BanStore) {
    const now = Date.now();
    globalThis._mockFail2BanStore = {
      jails: ["sshd", "nginx-http-auth", "pmmanager-auth"],
      bannedList: [
        {
          ip: "192.168.1.100",
          jail: "sshd",
          banTime: new Date(now - 3600000).toISOString(),
          bannedAt: new Date(now - 3600000).toISOString(),
        },
        {
          ip: "10.0.0.55",
          jail: "nginx-http-auth",
          banTime: new Date(now - 1800000).toISOString(),
          bannedAt: new Date(now - 1800000).toISOString(),
        },
      ],
    };
  }
  return globalThis._mockFail2BanStore;
}

/**
 * Reset mock store to default initial state (used for testing).
 */
export function resetMockFail2BanStore(): void {
  const now = Date.now();
  globalThis._mockFail2BanStore = {
    jails: ["sshd", "nginx-http-auth", "pmmanager-auth"],
    bannedList: [
      {
        ip: "192.168.1.100",
        jail: "sshd",
        banTime: new Date(now - 3600000).toISOString(),
        bannedAt: new Date(now - 3600000).toISOString(),
      },
      {
        ip: "10.0.0.55",
        jail: "nginx-http-auth",
        banTime: new Date(now - 1800000).toISOString(),
        bannedAt: new Date(now - 1800000).toISOString(),
      },
    ],
  };
}

/**
 * Check if the fail2ban-client CLI binary is installed and running on the host.
 */
async function isFail2BanClientAvailable(): Promise<boolean> {
  if (process.platform !== "linux") {
    return false;
  }
  try {
    const { stdout } = await execFileAsync("fail2ban-client", ["ping"], {
      timeout: 3000,
    });
    return (
      stdout.includes("Server replied: pong") ||
      stdout.includes("pong") ||
      stdout.trim() === "pong"
    );
  } catch {
    return false;
  }
}

/**
 * Retrieves Fail2Ban status (active jails and currently banned IPs).
 * Queries real fail2ban-client CLI when available on Linux,
 * otherwise falls back seamlessly to the in-memory mock store.
 */
export async function getFail2BanStatus(): Promise<Fail2BanStatusResult> {
  const isReal = await isFail2BanClientAvailable();

  if (isReal) {
    try {
      const { stdout } = await execFileAsync("fail2ban-client", ["status"], {
        timeout: 5000,
      });

      // Parse Jail list: sshd, nginx-http-auth
      const jailMatch = stdout.match(/Jail list:\s*([^\r\n]+)/i);
      const jails = jailMatch
        ? jailMatch[1]
            .split(",")
            .map((j) => j.trim())
            .filter(Boolean)
        : [];

      const bannedList: BannedIPRecord[] = [];

      for (const jail of jails) {
        try {
          const jailStatus = await execFileAsync(
            "fail2ban-client",
            ["status", jail],
            { timeout: 5000 }
          );
          const bannedMatch = jailStatus.stdout.match(
            /Banned IP list:\s*([^\r\n]*)/i
          );
          if (bannedMatch && bannedMatch[1].trim()) {
            const ips = bannedMatch[1].trim().split(/\s+/).filter(Boolean);
            const nowIso = new Date().toISOString();
            for (const ip of ips) {
              bannedList.push({
                ip,
                jail,
                banTime: nowIso,
                bannedAt: nowIso,
              });
            }
          }
        } catch (jailErr) {
          console.warn(`Failed to query status for jail ${jail}:`, jailErr);
        }
      }

      return {
        success: true,
        mode: "real",
        jails,
        bannedList,
      };
    } catch (cliErr) {
      console.warn("fail2ban-client status execution failed, falling back to mock store:", cliErr);
    }
  }

  // Fallback to in-memory state
  const store = getMockStore();

  return {
    success: true,
    mode: "mock",
    jails: [...store.jails],
    bannedList: [...store.bannedList],
  };
}

/**
 * Unbans an IP from a specific jail.
 * Validates inputs, rejects shell metacharacters, and executes CLI or updates mock store.
 */
export async function unbanIp({
  jail,
  ip,
}: UnbanOptions): Promise<UnbanResult> {
  const jailValidation = validateJail(jail);
  if (!jailValidation.valid) {
    throw new Fail2BanError(jailValidation.error || "Invalid jail parameter", 400);
  }

  const ipValidation = validateIp(ip);
  if (!ipValidation.valid) {
    throw new Fail2BanError(ipValidation.error || "Invalid IP parameter", 400);
  }

  const trimmedJail = jail.trim();
  const trimmedIp = ip.trim();

  const isReal = await isFail2BanClientAvailable();

  if (isReal) {
    try {
      // Execute command safely via execFile (without shell invocation)
      await execFileAsync(
        "fail2ban-client",
        ["set", trimmedJail, "unbanip", trimmedIp],
        { timeout: 5000 }
      );
      return {
        success: true,
        mode: "real",
        message: `IP ${trimmedIp} unbanned from jail ${trimmedJail}`,
      };
    } catch (cliErr: any) {
      const errOut = (cliErr?.stderr || cliErr?.stdout || cliErr?.message || "").toLowerCase();
      // If fail2ban reports IP is not banned, handle gracefully
      if (
        errOut.includes("not banned") ||
        errOut.includes("is not") ||
        errOut.includes("0")
      ) {
        return {
          success: true,
          mode: "real",
          message: `IP ${trimmedIp} unbanned from jail ${trimmedJail}`,
        };
      }
      throw new Fail2BanError(
        `Failed to unban IP: ${cliErr?.message || "fail2ban execution error"}`,
        500
      );
    }
  }

  // Fallback mock store mutation
  const store = getMockStore();
  store.bannedList = store.bannedList.filter(
    (item) => !(item.ip === trimmedIp && item.jail === trimmedJail)
  );

  return {
    success: true,
    mode: "mock",
    message: `IP ${trimmedIp} unbanned from jail ${trimmedJail}`,
  };
}
