import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { executePM2Action } from "@/lib/pm2-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const { action, id } = (body as { action?: unknown; id?: unknown }) ?? {};

    const user = session.user as any;
    if (user.role === "client") {
      if (id !== user.allowedProcess) {
        return NextResponse.json({ error: "Unauthorized for this process" }, { status: 403 });
      }
      // Optional: Maybe restrict clients from flushing or deleting, allow only restart
      if (action !== "restart") {
        return NextResponse.json({ error: "Clients can only restart processes" }, { status: 403 });
      }
    }

    const result = await executePM2Action(action, id);

    if (!result.success && result.statusCode) {
      return NextResponse.json(
        { error: result.error || result.message },
        { status: result.statusCode }
      );
    }

    return NextResponse.json(
      {
        success: true,
        mode: result.mode,
        message: result.message,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in POST /api/pm2/action:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
