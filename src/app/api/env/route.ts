import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";

export const dynamic = "force-dynamic";

const execAsync = (cmd: string) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) =>
    exec(cmd, (err, stdout, stderr) => (err ? reject(err) : resolve({ stdout, stderr })))
  );

/**
 * Mask sensitive environment values to prevent leaking secrets.
 */
function maskSecret(key: string, value: string): string {
  const sensitiveRegex = /secret|password|token|key|auth|credential|private|cert/i;
  if (!sensitiveRegex.test(key)) {
    return value;
  }
  if (!value || value.length <= 4) {
    return "********";
  }
  return `${value.slice(0, 2)}******${value.slice(-2)}`;
}

/**
 * GET /api/env
 * Returns server environment variables (with masked secrets) for Admin only.
 * Returns 401 if unauthenticated, 403 if not Admin.
 */
export async function GET(req: Request) {
  try {
    const authResult = await requireAdmin(req);
    if (authResult.error) {
      return authResult.error;
    }

    const envVars: { key: string; value: string; masked: boolean }[] = [];
    const sensitiveRegex = /secret|password|token|key|auth|credential|private|cert/i;

    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      const isSensitive = sensitiveRegex.test(k);
      envVars.push({
        key: k,
        value: maskSecret(k, v),
        masked: isSensitive,
      });
    }

    // Sort alphabetically by key
    envVars.sort((a, b) => a.key.localeCompare(b.key));

    return NextResponse.json({
      success: true,
      envVars,
      count: envVars.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/env
 * Reads or saves .env files on the server for Admin only.
 * Returns 401 if unauthenticated, 403 if not Admin.
 */
export async function POST(req: Request) {
  try {
    const authResult = await requireAdmin(req);
    if (authResult.error) {
      return authResult.error;
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { action, dirPath, envData, pm2Id } = (body as {
      action?: string;
      dirPath?: string;
      envData?: { key: string; value: string }[];
      pm2Id?: string | number;
    }) ?? {};

    if (!dirPath || typeof dirPath !== "string") {
      return NextResponse.json({ error: "Missing directory path" }, { status: 400 });
    }

    const targetPath = path.resolve(dirPath, ".env");

    if (action === "read") {
      let content = "";
      try {
        content = fs.readFileSync(targetPath, "utf-8");
      } catch (e: unknown) {
        const error = e as { code?: string; message?: string };
        if (error.code === "EACCES") {
          try {
            const { stdout } = await execAsync(`sudo -n cat "${targetPath}"`);
            content = stdout;
          } catch {
            return NextResponse.json({ error: "Cannot read .env (Permission denied)" }, { status: 403 });
          }
        } else if (error.code === "ENOENT") {
          content = ""; // file doesn't exist yet
        } else {
          return NextResponse.json({ error: error.message || "File read error" }, { status: 500 });
        }
      }

      // Parse env manually
      const envVars: { key: string; value: string }[] = [];
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          envVars.push({ key: match[1].trim(), value: match[2].trim() });
        }
      }
      return NextResponse.json({ envVars, raw: content, path: targetPath });
    } else if (action === "save") {
      if (!Array.isArray(envData)) {
        return NextResponse.json({ error: "Invalid envData" }, { status: 400 });
      }

      let newContent = "";
      for (const item of envData) {
        if (item && item.key) {
          newContent += `${item.key}=${item.value}\n`;
        }
      }

      try {
        fs.writeFileSync(targetPath, newContent);
      } catch (e: unknown) {
        const error = e as { code?: string; message?: string };
        if (error.code === "EACCES") {
          const tmpPath = path.join(os.tmpdir(), `env-${Date.now()}.tmp`);
          fs.writeFileSync(tmpPath, newContent);
          await execAsync(`sudo -n cp "${tmpPath}" "${targetPath}" && sudo -n chmod 600 "${targetPath}"`);
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            // Ignore tmp cleanup error
          }
        } else {
          return NextResponse.json({ error: error.message || "File write error" }, { status: 500 });
        }
      }

      let restartMsg = "";
      if (pm2Id !== undefined && pm2Id !== "") {
        try {
          await execAsync(`pm2 restart ${pm2Id}`);
          restartMsg = ` and restarted PM2 process ${pm2Id}`;
        } catch {
          // Non-critical PM2 restart warning
        }
      }

      return NextResponse.json({ success: true, message: `Saved .env successfully${restartMsg}` });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
