import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import { listNginxFiles } from "@/lib/nginx-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authResult = await requireAdmin(request);
    if (authResult.error) {
      return authResult.error;
    }

    const data = await listNginxFiles();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error in GET /api/nginx/files:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
