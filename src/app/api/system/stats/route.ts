import { NextResponse } from "next/server";
import { auth } from "@/auth";
import os from "os";
import fs from "fs";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    const cpus = os.cpus();
    const load = os.loadavg();
    const totalMem = os.totalmem();
    
    const freeMem = os.freemem();
    
    let disk = { total: 0, free: 0, used: 0, usagePercent: 0 };
    try {
      const stat = fs.statfsSync(process.platform === 'win32' ? 'C:\\' : '/');
      const total = stat.blocks * stat.bsize;
      const free = stat.bavail * stat.bsize;
      disk = {
        total,
        free,
        used: total - free,
        usagePercent: total > 0 ? ((total - free) / total) * 100 : 0
      };
    } catch (err) {}
    
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
      disk,
      uptime: os.uptime(),
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release()
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}