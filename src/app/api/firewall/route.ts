import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { exec } from "child_process";

const execAsync = (cmd: string) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) =>
    exec(cmd, (err, stdout, stderr) => (err ? reject(err) : resolve({ stdout, stderr })))
  );

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { stdout } = await execAsync("sudo -n ufw status numbered").catch((e) => ({ stdout: e.stdout || e.message }));
    
    let isActive = stdout.includes("Status: active");
    
    const rules = [];
    const lines = stdout.split('\n');
    for (const line of lines) {
      const match = line.match(/^\[\s*(\d+)\]\s+(.*?)\s+(ALLOW IN|DENY IN)\s+(.*)$/);
      if (match) {
        rules.push({
          id: match[1],
          to: match[2].trim(),
          action: match[3].trim(),
          from: match[4].trim(),
        });
      }
    }

    return NextResponse.json({ active: isActive, rules, raw: stdout });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { action, port, protocol, id } = body;

    let cmd = "";
    if (action === "enable") cmd = "sudo -n ufw --force enable";
    else if (action === "disable") cmd = "sudo -n ufw disable";
    else if (action === "allow") cmd = `sudo -n ufw allow ${port}${protocol ? '/' + protocol : ''}`;
    else if (action === "deny") cmd = `sudo -n ufw deny ${port}${protocol ? '/' + protocol : ''}`;
    else if (action === "delete") cmd = `sudo -n ufw --force delete ${id}`;
    else return NextResponse.json({ error: "Invalid action" }, { status: 400 });

    const { stdout, stderr } = await execAsync(cmd);

    return NextResponse.json({ success: true, stdout, stderr });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
