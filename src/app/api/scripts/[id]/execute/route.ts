import { NextResponse } from "next/server";
import { auth } from "@/auth";
import db from "@/lib/db";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    const { id } = await params;
    const stmt = db.prepare('SELECT * FROM scripts WHERE id = ?');
    const script = stmt.get(id) as any;
    if (!script) return NextResponse.json({ error: "Script not found" }, { status: 404 });
    
    const tmpFile = path.join(os.tmpdir(), `script_${Date.now()}.sh`);
    fs.writeFileSync(tmpFile, script.content, { mode: 0o755 });
    
    return await new Promise<NextResponse>((resolve) => {
      exec(`bash ${tmpFile}`, { timeout: 60000 }, (error, stdout, stderr) => {
        try {
          resolve(NextResponse.json({
            success: !error,
            output: stdout || stderr,
            error: error ? error.message : null
          }));
        } finally {
          try {
            if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
          } catch {
            // Ignore cleanup failure
          }
        }
      });
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}