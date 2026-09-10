import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getVitalsHistory } from "@/lib/db";
import { startVitalsWorker } from "@/lib/vitals-worker";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Ensure authentication guard
  const authResult = await requireAuth(req);
  if (authResult.error) {
    return authResult.error;
  }
  const session = authResult.session;
  const user = session?.user as any;

  // Ensure worker is running
  startVitalsWorker();

  const { searchParams } = new URL(req.url);
  let processParam = searchParams.get("process");

  if (user?.role === "client") {
    const allowed = user.allowedProcess;
    if (processParam && processParam !== allowed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    // Force the param to their allowed process if none provided
    processParam = allowed;
  }

  const hoursParam = searchParams.get("hours");

  // Parse hours gracefully for boundary testing
  let hours = 24;
  if (hoursParam !== null) {
    const parsed = parseInt(hoursParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      hours = parsed;
    }
  }

  // Query database for historical vitals (idempotent and read-only)
  const data = getVitalsHistory(processParam || undefined, hours);

  return NextResponse.json({
    success: true,
    process: processParam || undefined,
    hours,
    data: data.map((d) => ({
      id: d.id,
      process: d.process,
      processName: d.process,
      processId: String(d.id || "0"),
      cpu: d.cpu,
      memory: d.memory,
      timestamp: d.timestamp,
    })),
  });
}

export async function POST() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export async function PUT() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export async function DELETE() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
