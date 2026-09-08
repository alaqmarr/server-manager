import { NextResponse } from "next/server";
import { auth } from "@/auth";
import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";

const execAsync = (cmd: string) => new Promise<{stdout: string, stderr: string}>((resolve, reject) => exec(cmd, (err, stdout, stderr) => err ? reject(err) : resolve({stdout, stderr})));

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const targetDir = formData.get("targetDir") as string;

    if (!file || !targetDir) {
      return NextResponse.json({ error: "Missing file or target directory" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const targetPath = path.join(targetDir, file.name);

    try {
      fs.writeFileSync(targetPath, buffer);
    } catch (err: any) {
      if (err.code === 'EACCES') {
        const tempPath = path.join(os.tmpdir(), `upload-${Date.now()}-${file.name}`);
        fs.writeFileSync(tempPath, buffer);
        await execAsync(`sudo -n cp ${tempPath} ${targetPath}`);
        fs.unlinkSync(tempPath);
      } else {
        throw err;
      }
    }

    return NextResponse.json({ success: true, message: "File uploaded successfully" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
