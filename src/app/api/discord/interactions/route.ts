import { NextRequest, NextResponse } from "next/server";
import { verifyKey, InteractionType, InteractionResponseType } from "discord-interactions";
import os from "os";
import { getPM2Processes, executePM2Action, getPM2Logs } from "@/lib/pm2-service";

async function editInteractionResponse(applicationId: string, token: string, data: any) {
  const url = `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`;
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    console.log(`[Discord] Webhook response status: ${res.status}`);
    if (!res.ok) {
      console.error("[Discord] Webhook error response:", await res.text());
    }
  } catch (err) {
    console.error("Failed to edit interaction response:", err);
  }
}

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

  console.log("[Discord] Incoming request payload:", rawBody.substring(0, 200) + "...");
  const isValidRequest = await verifyKey(rawBody, signature, timestamp, PUBLIC_KEY);
  if (!isValidRequest) {
    console.error("[Discord] 🚨 SIGNATURE VALIDATION FAILED for payload:", rawBody);
    return NextResponse.json({ error: "Bad request signature" }, { status: 401 });
  }

  const interaction = JSON.parse(rawBody);
  console.log(`[Discord] Valid interaction received. Type: ${interaction.type}, Command: ${interaction.data?.name}`);

  if (interaction.type === InteractionType.PING) {
    return NextResponse.json({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const commandName = interaction.data.name;
    const appId = interaction.application_id;
    const token = interaction.token;
    
    // Auth Check
    const adminId = process.env.DISCORD_ADMIN_ID;
    if (["restart", "start", "stop", "flush", "logs"].includes(commandName)) {
      if (!adminId) {
         return NextResponse.json({
           type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
           data: { content: "⚠️ SECURITY LOCKOUT: You must add `DISCORD_ADMIN_ID` to your environment variables on the Nexus Dashboard to use this command." }
         });
      }
      if (interaction.member?.user?.id !== adminId && interaction.user?.id !== adminId) {
         const callerId = interaction.member?.user?.id || interaction.user?.id;
         return NextResponse.json({
           type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
           data: { content: `🚫 ACCESS DENIED: You do not have permission to execute this command. (Your ID: ${callerId})` }
         });
      }
    }

    // BACKGROUND PROCESSING (so Discord doesn't timeout after 3s)
    const processCommand = async () => {
      if (commandName === "status") {
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
            title: "💻 Nexus Server Status",
            color: 0x00ff00,
            fields: [
              {
                name: "🖥️ Host System",
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

          const offlineApps = pm2Data.processes.filter(p => p.status !== "online");
          if (offlineApps.length > 0) {
            embed.color = 0xffa500;
            embed.fields.push({
              name: "⚠️ Offline Applications",
              value: offlineApps.map(p => `- ${p.name} (${p.status})`).join("\n"),
              inline: false
            });
          }

          await editInteractionResponse(appId, token, { embeds: [embed] });
        } catch (err) {
          await editInteractionResponse(appId, token, { content: "❌ Error retrieving status: " + (err instanceof Error ? err.message : String(err)) });
        }
      }

      if (["restart", "start", "stop", "flush"].includes(commandName)) {
         const appArg = interaction.data.options?.[0]?.value || "all";
         try {
           const result = await executePM2Action(commandName, appArg);
           await editInteractionResponse(appId, token, { content: result.success ? `✅ Successfully executed ${commandName} on ${appArg}` : `❌ Failed to ${commandName}: ${result.message}` });
         } catch (err) {
           await editInteractionResponse(appId, token, { content: "❌ Error executing command: " + (err instanceof Error ? err.message : String(err)) });
         }
      }

      if (commandName === "logs") {
         const appArg = interaction.data.options?.[0]?.value;
         try {
           const logs = await getPM2Logs(appArg, 15);
           const safeLogs = logs.length > 1900 ? logs.substring(logs.length - 1900) : logs;
           await editInteractionResponse(appId, token, { content: `📜 **Logs for ${appArg}:**\n\`\`\`\n${safeLogs}\n\`\`\`` });
         } catch (err) {
           await editInteractionResponse(appId, token, { content: "❌ Error fetching logs: " + (err instanceof Error ? err.message : String(err)) });
         }
      }
    };

    // Execute in background
    processCommand();

    // Respond immediately with DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE (type 5)
    // This tells Discord "The bot is thinking..." and prevents the 3-second timeout
    return NextResponse.json({
      type: 5
    });
  }

  return NextResponse.json({ error: "Unknown interaction" }, { status: 400 });
}
