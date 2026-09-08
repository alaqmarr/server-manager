import { NextResponse } from "next/server";
import { auth } from "@/auth";
import fs from "fs";
import { exec } from "child_process";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    const url = new URL(req.url);
    const file = url.searchParams.get("file") || "/var/log/syslog";
    const lines = url.searchParams.get("lines") || "100";
    
    return new Promise<NextResponse>((resolve) => {
      exec(`sudo -n tail -n ${lines} ${file}`, (error, stdout, stderr) => {
        if (error) {
           // fallback to readFileSync if sudo fails and file is readable
           try {
             const content = fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8");
             const tail = content.split('\n').slice(-parseInt(lines)).join('\n');
             resolve(NextResponse.json({ content: tail }));
           } catch(e: any) {
             resolve(NextResponse.json({ error: e.message }, { status: 500 }));
           }
        } else {
           resolve(NextResponse.json({ content: stdout || stderr }));
        }
      });
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}