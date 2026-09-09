import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getUptimeMonitorById } from "@/lib/db";
import { performUptimeCheck } from "@/lib/uptime-service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) {
    return error;
  }

  const { searchParams } = new URL(req.url);
  let id = searchParams.get("id");

  if (!id) {
    try {
      const body = await req.json();
      if (body && body.id !== undefined) {
        id = String(body.id);
      }
    } catch {
      // Body was not JSON
    }
  }

  if (!id) {
    return NextResponse.json(
      { error: "Monitor ID is required" },
      { status: 400 }
    );
  }

  const monitorId = parseInt(id, 10);
  if (isNaN(monitorId) || monitorId <= 0) {
    return NextResponse.json(
      { error: "Invalid monitor ID" },
      { status: 400 }
    );
  }

  const monitor = getUptimeMonitorById(monitorId);
  if (!monitor) {
    return NextResponse.json(
      { error: "Monitor not found" },
      { status: 404 }
    );
  }

  try {
    const check = await performUptimeCheck(monitorId);
    return NextResponse.json({
      success: true,
      check,
    });
  } catch (err: any) {
    console.error(`Error performing check on monitor ${monitorId}:`, err);
    return NextResponse.json(
      { error: err.message || "Failed to execute uptime check" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
