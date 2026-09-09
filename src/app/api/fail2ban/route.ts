import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getFail2BanStatus } from "@/lib/fail2ban-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/fail2ban
 * Returns current Fail2Ban status: list of active jails and banned IPs.
 * Accessible to any authenticated user (Admin or Developer).
 */
export async function GET(req: Request) {
  try {
    const authResult = await requireAuth(req);
    if (authResult.error) {
      return authResult.error;
    }

    const status = await getFail2BanStatus();
    return NextResponse.json(status, { status: 200 });
  } catch (err: any) {
    console.error("Error in GET /api/fail2ban:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
