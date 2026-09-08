import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getActivePorts } from "@/lib/ports-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await getActivePorts();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error in GET /api/ports:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
