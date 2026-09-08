import { NextResponse } from "next/server";
import { auth } from "@/auth";
import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";

export const dynamic = "force-dynamic";

const execAsync = (cmd: string) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) =>
    exec(cmd, (err, stdout, stderr) => (err ? reject(err) : resolve({ stdout, stderr })))
  );

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { action, dirPath, envData, pm2Id } = body;

    if (!dirPath) return NextResponse.json({ error: "Missing directory path" }, { status: 400 });
    const targetPath = path.resolve(dirPath, ".env");

    if (action === "read") {
      let content = "";
      try {
        content = fs.readFileSync(targetPath, "utf-8");
      } catch (e: any) {
        if (e.code === 'EACCES') {
          try {
            const { stdout } = await execAsync(`sudo -n cat "${targetPath}"`);
            content = stdout;
          } catch (sudoErr: any) {
            return NextResponse.json({ error: `Cannot read .env (Permission denied)` }, { status: 403 });
          }
        } else if (e.code === 'ENOENT') {
          content = ""; // file doesn't exist yet
        } else {
          return NextResponse.json({ error: e.message }, { status: 500 });
        }
      }

      // Parse env manually
      const envVars: { key: string, value: string }[] = [];
      const lines = content.split('\\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          envVars.push({ key: match[1].trim(), value: match[2].trim() });
        }
      }
      return NextResponse.json({ envVars, raw: content, path: targetPath });
    } else if (action === "save") {
      if (!Array.isArray(envData)) return NextResponse.json({ error: "Invalid envData" }, { status: 400 });
      
      let newContent = "";
      for (const item of envData) {
        if (item.key) newContent += `${item.key}=${item.value}\\n`;
      }

      try {
        fs.writeFileSync(targetPath, newContent);
      } catch (e: any) {
        if (e.code === 'EACCES') {
          const tmpPath = path.join(os.tmpdir(), `env-${Date.now()}.tmp`);
          fs.writeFileSync(tmpPath, newContent);
          await execAsync(`sudo -n cp "${tmpPath}" "${targetPath}" && sudo -n chmod 600 "${targetPath}"`);
          fs.unlinkSync(tmpPath);
        } else {
          return NextResponse.json({ error: e.message }, { status: 500 });
        }
      }

      let restartMsg = "";
      if (pm2Id !== undefined && pm2Id !== "") {
        await execAsync(`pm2 restart ${pm2Id}`);
        restartMsg = ` and restarted PM2 process ${pm2Id}`;
      }

      return NextResponse.json({ success: true, message: `Saved .env successfully${restartMsg}` });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
