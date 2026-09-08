import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listNginxFiles } from "@/lib/nginx-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
