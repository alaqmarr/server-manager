import { NextResponse } from "next/server";
import { auth } from "@/auth";
import os from "os";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    const cpus = os.cpus();
    const load = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    
    return NextResponse.json({
      cpu: {
        model: cpus[0]?.model,
        cores: cpus.length,
        load: load
      },
      memory: {
        total: totalMem,
        free: freeMem,
        used: totalMem - freeMem,
        usagePercent: ((totalMem - freeMem) / totalMem) * 100
      },
      uptime: os.uptime(),
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release()
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}