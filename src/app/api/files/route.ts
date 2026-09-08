import { NextResponse } from "next/server";
import { auth } from "@/auth";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import os from "os";

const execAsync = (cmd: string) => new Promise<{stdout: string, stderr: string}>((resolve, reject) => exec(cmd, (err, stdout, stderr) => err ? reject(err) : resolve({stdout, stderr})));

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    const url = new URL(req.url);
    const dir = url.searchParams.get("dir") || process.cwd();
    const resolved = path.resolve(dir);
    
    if (!fs.existsSync(/*turbopackIgnore: true*/ resolved)) return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    
    const items = fs.readdirSync(/*turbopackIgnore: true*/ resolved, { withFileTypes: true }).map(item => ({
      name: item.name,
      isDirectory: item.isDirectory(),
      path: path.join(resolved, item.name).replace(/\\/g, "/")
    })).sort((a, b) => {
      if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
      return a.isDirectory ? -1 : 1;
    });
    
    return NextResponse.json({ currentDir: resolved.replace(/\\/g, "/"), parentDir: path.dirname(resolved).replace(/\\/g, "/"), items });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { action, target, content } = await req.json();
    
    if (!target) return NextResponse.json({ error: "Missing target path" }, { status: 400 });
    
        if (action === 'read') {
      if (!fs.existsSync(/*turbopackIgnore: true*/ target) || !fs.statSync(target).isFile()) return NextResponse.json({ error: "File not found" }, { status: 404 });
      return NextResponse.json({ content: fs.readFileSync(target, "utf8") });
    } else if (action === 'save') {
      try {
        fs.writeFileSync(target, content || "", "utf8");
      } catch (err: any) {
        if (err.code === 'EACCES') {
          const sysTempPath = path.join(os.tmpdir(), `file-save-${Date.now()}.tmp`);
          fs.writeFileSync(sysTempPath, content || "", "utf8");
          await execAsync(`sudo -n cp ${sysTempPath} ${target}`);
          fs.unlinkSync(sysTempPath);
        } else {
          throw err;
        }
      }
      return NextResponse.json({ success: true });
    } else if (action === 'delete') {
      try {
        if (fs.statSync(target).isDirectory()) {
          fs.rmSync(target, { recursive: true, force: true });
        } else {
          fs.unlinkSync(target);
        }
      } catch (err: any) {
        if (err.code === 'EACCES') {
          await execAsync(`sudo -n rm -rf ${target}`);
        } else {
          throw err;
        }
      }
      return NextResponse.json({ success: true });
    } else if (action === 'mkdir') {
      try {
        fs.mkdirSync(target, { recursive: true });
      } catch (err: any) {
        if (err.code === 'EACCES') {
          await execAsync(`sudo -n mkdir -p ${target}`);
        } else {
          throw err;
        }
      }
      return NextResponse.json({ success: true });
    } else if (action === 'delete') {
      if (fs.statSync(target).isDirectory()) {
        fs.rmSync(target, { recursive: true, force: true });
      } else {
        fs.unlinkSync(target);
      }
      return NextResponse.json({ success: true });
    } else if (action === 'mkdir') {
      fs.mkdirSync(target, { recursive: true });
      return NextResponse.json({ success: true });
    }
    
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}