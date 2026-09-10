import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import {
  getUptimeMonitors,
  getUptimeMonitorById,
  createUptimeMonitor,
  deleteUptimeMonitor,
} from "@/lib/db";
import {
  performUptimeCheck,
  startUptimeWorker,
} from "@/lib/uptime-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) {
    return error;
  }

  // Ensure worker is running
  startUptimeWorker();

  const monitors = getUptimeMonitors();
  return NextResponse.json({
    success: true,
    monitors,
  });
}

export async function POST(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) {
    return error;
  }

  startUptimeWorker();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  if (!body) {
    return NextResponse.json(
      { error: "Monitor payload is required" },
      { status: 400 }
    );
  }

  // Name validation
  if (!body.name || typeof body.name !== "string" || body.name.trim() === "") {
    return NextResponse.json(
      { error: "Monitor name is required" },
      { status: 400 }
    );
  }

  // URL validation: must be a valid HTTP or HTTPS URL
  if (
    !body.url ||
    typeof body.url !== "string" ||
    (!body.url.startsWith("http://") && !body.url.startsWith("https://"))
  ) {
    return NextResponse.json(
      { error: "Valid HTTP/HTTPS URL is required" },
      { status: 400 }
    );
  }

  try {
    new URL(body.url);
  } catch {
    return NextResponse.json(
      { error: "Valid HTTP/HTTPS URL is required" },
      { status: 400 }
    );
  }

  // Interval validation
  if (body.intervalSeconds !== undefined) {
    const intervalNum = Number(body.intervalSeconds);
    if (isNaN(intervalNum) || intervalNum <= 0) {
      return NextResponse.json(
        { error: "Interval must be greater than zero" },
        { status: 400 }
      );
    }
  }

  const intervalSeconds = Number(body.intervalSeconds) || 60;
  const created = createUptimeMonitor(body.name.trim(), body.url.trim(), intervalSeconds);

  // Perform initial ping check immediately upon creation
  try {
    await performUptimeCheck(created.id);
  } catch (checkErr) {
    console.warn(`Initial check for monitor ${created.id} failed:`, checkErr);
  }

  const monitor = getUptimeMonitorById(created.id) || created;

  return NextResponse.json(
    {
      success: true,
      monitor,
    },
    { status: 201 }
  );
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) {
    return error;
  }

  const { searchParams } = new URL(req.url);
  let id = searchParams.get("id");

  if (!id) {
    try {
      const body = await req.json();
      if (body && body.id) {
        id = String(body.id);
      }
    } catch {
      // Ignored if request had no JSON body
    }
  }

  if (!id) {
    return NextResponse.json(
      { error: "Missing monitor ID" },
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

  deleteUptimeMonitor(monitorId);

  return NextResponse.json({
    success: true,
    message: "Monitor deleted successfully",
  });
}
