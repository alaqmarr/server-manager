import { NextRequest, NextResponse } from "next/server";
import { verifyKey, InteractionType, InteractionResponseType } from "discord-interactions";
import os from "os";
import { getPM2Processes } from "@/lib/pm2-service";

export async function POST(req: NextRequest) {
  const signature = req.headers.get("X-Signature-Ed25519");
  const timestamp = req.headers.get("X-Signature-Timestamp");
  const rawBody = await req.text();

  if (!signature || !timestamp) {
    return NextResponse.json({ error: "Missing signature headers" }, { status: 401 });
  }

  const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
  if (!PUBLIC_KEY) {
    console.error("Missing DISCORD_PUBLIC_KEY environment variable");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  // Verify the request came from Discord
  const isValidRequest = await verifyKey(rawBody, signature, timestamp, PUBLIC_KEY);
  if (!isValidRequest) {
    return NextResponse.json({ error: "Bad request signature" }, { status: 401 });
  }

  const interaction = JSON.parse(rawBody);

  // Handle Discord PING validation
  if (interaction.type === InteractionType.PING) {
    return NextResponse.json({ type: InteractionResponseType.PONG });
  }

  // Handle Slash Commands
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    if (interaction.data.name === "status") {
      try {
        const pm2Data = await getPM2Processes();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memPercent = ((usedMem / totalMem) * 100).toFixed(1);
        
        const loadAvg = os.loadavg();
        const uptimeSeconds = os.uptime();
        const days = Math.floor(uptimeSeconds / (3600 * 24));
        const hours = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);

        const activeProcesses = pm2Data.processes.filter(p => p.status === "online").length;
        const totalProcesses = pm2Data.processes.length;

        const embed = {
          title: "🚀 Nexus Server Status",
          color: 0x00ff00, // Green
          fields: [
            {
              name: "💻 Host System",
              value: `**OS Uptime:** ${days}d ${hours}h\n**CPU Load (1m):** ${loadAvg[0].toFixed(2)}\n**Memory Usage:** ${memPercent}% (${(usedMem / 1024 / 1024 / 1024).toFixed(1)}GB / ${(totalMem / 1024 / 1024 / 1024).toFixed(1)}GB)`,
              inline: false,
            },
            {
              name: "⚙️ PM2 Applications",
              value: `**Active Apps:** ${activeProcesses} / ${totalProcesses}\n**Overall CPU:** ${pm2Data.summary.avgCpuPercent.toFixed(1)}%\n**Overall Memory:** ${(pm2Data.summary.totalMemoryBytes / 1024 / 1024).toFixed(1)} MB`,
              inline: false,
            }
          ],
          timestamp: new Date().toISOString(),
          footer: {
            text: "Nexus Server Manager",
          }
        };

        // If there are specific apps offline, list them
        const offlineApps = pm2Data.processes.filter(p => p.status !== "online");
        if (offlineApps.length > 0) {
          embed.color = 0xffa500; // Orange/Warning
          embed.fields.push({
            name: "⚠️ Offline Applications",
            value: offlineApps.map(p => `- ${p.name} (${p.status})`).join("\n"),
            inline: false
          });
        }

        return NextResponse.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [embed]
          }
        });
      } catch (err) {
        console.error("Failed to fetch status:", err);
        return NextResponse.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: "❌ Failed to retrieve server status. Check logs."
          }
        });
      }
    }
  }

  // Unknown command
  return NextResponse.json({ error: "Unknown interaction type" }, { status: 400 });
}
