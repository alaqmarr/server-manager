export const AUTHORITATIVE_DISCORD_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1547135127182639125/g4BMcJ7KS4y_YcNyc1sfrNuR5Af5R2xcQt0wDnsQw9_tYv6Uv2zJTzeUKeyiDN6EZpgB";

export const ALERT_COLORS = {
  crash: 15158332, // Red (#E74C3C)
  error: 15158332,
  cpu_spike: 15105570, // Orange (#E67E22)
  warning: 15105570,
  test: 3447003, // Blue (#3498DB)
  info: 3447003,
  success: 3066993, // Green (#2ECC71)
} as const;

export type AlertLevel = keyof typeof ALERT_COLORS;

export interface DiscordEmbedField {
  name: string;
  value: string | number;
  inline?: boolean;
}

export interface DiscordAlertOptions {
  title: string;
  description: string;
  level?: AlertLevel;
  color?: number;
  fields?: DiscordEmbedField[];
  processName?: string;
  bypassCooldown?: boolean;
  url?: string;
}

export interface DiscordAlertResult {
  success: boolean;
  statusCode: number;
  message?: string;
  error?: string;
  rateLimited?: boolean;
  responseData?: any;
}

// 10 minutes per process cooldown window
export const COOLDOWN_DURATION_MS = 10 * 60 * 1000;

declare global {
  var __discordAlertCooldowns: Map<string, number> | undefined;
}

function getCooldownMap(): Map<string, number> {
  if (!globalThis.__discordAlertCooldowns) {
    globalThis.__discordAlertCooldowns = new Map<string, number>();
  }
  return globalThis.__discordAlertCooldowns;
}

export function clearAlertCooldowns(): void {
  getCooldownMap().clear();
}

export function getAlertCooldowns(): Record<string, number> {
  const result: Record<string, number> = {};
  getCooldownMap().forEach((val, key) => {
    result[key] = val;
  });
  return result;
}

export function resolveColor(level?: AlertLevel, customColor?: number): number {
  if (customColor !== undefined) return customColor;
  if (level && level in ALERT_COLORS) {
    return ALERT_COLORS[level];
  }
  return ALERT_COLORS.info;
}

/**
 * Dispatches a rich Discord embed to the authoritative Discord webhook URL.
 * Enforces a 10-minute cooldown per process to prevent notification flooding.
 */
export async function sendDiscordAlert(
  options: DiscordAlertOptions
): Promise<DiscordAlertResult> {
  const webhookUrl =
    options.url ||
    process.env.DISCORD_WEBHOOK_URL ||
    AUTHORITATIVE_DISCORD_WEBHOOK_URL;

  // Check 10-minute alert cooldown per process
  if (!options.bypassCooldown && options.processName) {
    const cooldownKey = `${options.processName}:${options.level || "alert"}`;
    const lastSent = getCooldownMap().get(cooldownKey);
    const now = Date.now();
    if (lastSent && now - lastSent < COOLDOWN_DURATION_MS) {
      const remainingSec = Math.ceil((COOLDOWN_DURATION_MS - (now - lastSent)) / 1000);
      return {
        success: false,
        statusCode: 429,
        rateLimited: true,
        message: `Alert cooldown active for process '${options.processName}'. Retry in ${remainingSec}s.`,
      };
    }
  }

  const embedColor = resolveColor(options.level, options.color);
  const embed = {
    title: options.title,
    description: options.description,
    color: embedColor,
    fields: options.fields?.map((f) => ({
      name: f.name,
      value: String(f.value),
      inline: f.inline !== false,
    })),
    footer: {
      text: "Nexus Server Manager • Alerts Engine",
    },
    timestamp: new Date().toISOString(),
  };

  const payload = {
    username: "Nexus Server Monitor",
    avatar_url: "https://cdn-icons-png.flaticon.com/512/906/906343.png",
    embeds: [embed],
  };

  // Append ?wait=true if not present so Discord returns the full message object with 200 OK
  const targetUrl = webhookUrl.includes("?")
    ? webhookUrl.includes("wait=")
      ? webhookUrl
      : `${webhookUrl}&wait=true`
    : `${webhookUrl}?wait=true`;

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const statusCode = response.status;
    const isSuccess = statusCode >= 200 && statusCode < 300;

    let responseData: any = null;
    try {
      const text = await response.text();
      if (text) {
        responseData = JSON.parse(text);
      }
    } catch {
      // Ignored if non-JSON
    }

    if (isSuccess) {
      // Record cooldown timestamp on success
      if (options.processName) {
        const cooldownKey = `${options.processName}:${options.level || "alert"}`;
        getCooldownMap().set(cooldownKey, Date.now());
      }

      return {
        success: true,
        statusCode,
        message: "Discord alert dispatched successfully",
        responseData,
      };
    }

    if (statusCode === 429) {
      return {
        success: false,
        statusCode: 429,
        rateLimited: true,
        error: "Discord rate limit reached",
        responseData,
      };
    }

    return {
      success: false,
      statusCode,
      error: `Discord API returned status ${statusCode}`,
      responseData,
    };
  } catch (err: any) {
    console.error("[Discord Service] Network error dispatching alert:", err);
    return {
      success: false,
      statusCode: 500,
      error: err.message || "Failed to reach Discord webhook",
    };
  }
}

/**
 * Dispatches a test embed to the authoritative Discord webhook URL.
 * Returns 2xx status code from Discord API.
 */
export async function testDiscordWebhook(
  customUrl?: string
): Promise<DiscordAlertResult> {
  const result = await sendDiscordAlert({
    title: "🧪 Test Alert: Discord Webhook Integration",
    description: "Verification test executed successfully from Nexus Server Manager.",
    level: "test",
    fields: [
      { name: "Status", value: "Active", inline: true },
      { name: "Environment", value: process.env.NODE_ENV || "production", inline: true },
      { name: "Timestamp", value: new Date().toISOString(), inline: true },
    ],
    bypassCooldown: true,
    url: customUrl,
  });

  return result;
}

/**
 * Checks running PM2 processes and fires Discord alerts on crashes or CPU spikes (>80%).
 */
export async function checkVitalsAndAlert(
  processes: Array<{
    name: string;
    id: number | string;
    status: string;
    cpu: number;
    memory: number;
    restarts: number;
  }>
): Promise<DiscordAlertResult[]> {
  const results: DiscordAlertResult[] = [];

  for (const proc of processes) {
    // 1. App Crash Alert (status === "errored" or status === "stopped" with restarts > 0)
    if (proc.status === "errored" || (proc.status === "stopped" && proc.restarts > 0)) {
      const memoryMB = (proc.memory / (1024 * 1024)).toFixed(1);
      const crashAlert = await sendDiscordAlert({
        title: `🚨 Process Crash Detected: ${proc.name}`,
        description: `PM2 process **${proc.name}** (ID: ${proc.id}) has entered status \`${proc.status}\`.`,
        level: "crash",
        processName: proc.name,
        fields: [
          { name: "Process ID", value: String(proc.id), inline: true },
          { name: "Status", value: proc.status, inline: true },
          { name: "Restarts", value: String(proc.restarts), inline: true },
          { name: "Memory", value: `${memoryMB} MB`, inline: true },
          { name: "CPU", value: `${proc.cpu.toFixed(1)}%`, inline: true },
        ],
      });
      results.push(crashAlert);
    }

    // 2. High CPU Spike Alert (cpu > 80%)
    if (proc.cpu > 80.0) {
      const memoryMB = (proc.memory / (1024 * 1024)).toFixed(1);
      const cpuAlert = await sendDiscordAlert({
        title: `⚠️ High CPU Spike Alert: ${proc.name}`,
        description: `PM2 process **${proc.name}** (ID: ${proc.id}) has exceeded the 80% CPU threshold.`,
        level: "cpu_spike",
        processName: proc.name,
        fields: [
          { name: "Current CPU", value: `${proc.cpu.toFixed(1)}%`, inline: true },
          { name: "Threshold", value: "80.0%", inline: true },
          { name: "Process ID", value: String(proc.id), inline: true },
          { name: "Memory", value: `${memoryMB} MB`, inline: true },
        ],
      });
      results.push(cpuAlert);
    }
  }

  return results;
}
