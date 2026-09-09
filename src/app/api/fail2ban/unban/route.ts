import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import { unbanIp, Fail2BanError, hasShellMetachars } from "@/lib/fail2ban-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/fail2ban/unban
 * Unbans a specific IP from a specified jail.
 * Restricted to users with the Admin role. Developers strictly receive 403 Forbidden.
 */
export async function POST(req: Request) {
  try {
    const authResult = await requireAdmin(req);
    if (authResult.error) {
      return authResult.error;
    }

    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON or missing request body" },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Missing request body" },
        { status: 400 }
      );
    }

    // 1. Parameter presence checks
    if (
      body.jail === undefined ||
      body.jail === null ||
      typeof body.jail !== "string" ||
      body.jail.trim() === ""
    ) {
      return NextResponse.json(
        { error: "Missing jail parameter" },
        { status: 400 }
      );
    }

    if (
      body.ip === undefined ||
      body.ip === null ||
      typeof body.ip !== "string" ||
      body.ip.trim() === ""
    ) {
      return NextResponse.json(
        { error: "Missing IP parameter" },
        { status: 400 }
      );
    }

    const jail = body.jail.trim();
    const ip = body.ip.trim();

    // 2. Command injection & metacharacter protection
    if (hasShellMetachars(jail) || hasShellMetachars(ip)) {
      return NextResponse.json(
        { error: "Invalid IP address. Malformed characters detected" },
        { status: 400 }
      );
    }

    try {
      const result = await unbanIp({ jail, ip });
      return NextResponse.json(result, { status: 200 });
    } catch (err: any) {
      if (err instanceof Fail2BanError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.statusCode }
        );
      }
      return NextResponse.json(
        { error: err?.message || "Failed to unban IP" },
        { status: 400 }
      );
    }
  } catch (err: any) {
    console.error("Error in POST /api/fail2ban/unban:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
