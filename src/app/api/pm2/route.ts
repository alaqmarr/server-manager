import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPM2Processes } from "@/lib/pm2-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await getPM2Processes();
    const user = session.user as any;

    if (user.role === "client") {
      const allowed = user.allowedProcess;
      if (!allowed) return NextResponse.json({ ...data, processes: [] }, { status: 200 });
      return NextResponse.json({ ...data, processes: data.processes.filter((p: any) => p.name === allowed) }, { status: 200 });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error in GET /api/pm2:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
