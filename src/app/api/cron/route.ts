import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { exec } from "child_process";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    return new Promise<NextResponse>((resolve) => {
      exec("crontab -l", (error, stdout) => {
        resolve(NextResponse.json({ content: stdout || "" }));
      });
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    const { content } = body || {};
    if (typeof content !== 'string') return NextResponse.json({ error: "Invalid content" }, { status: 400 });
    
    return new Promise<NextResponse>((resolve) => {
      const p = exec("crontab -", (error, stdout, stderr) => {
        resolve(NextResponse.json({ success: !error, error: error ? error.message : null }));
      });
      p.stdin?.write(content + "\n");
      p.stdin?.end();
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}