import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readNginxFile, NginxError } from "@/lib/nginx-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const file = searchParams.get("file");

    if (!file || file.trim() === "") {
      return NextResponse.json(
        { error: "Missing file parameter" },
        { status: 400 }
      );
    }

    const data = await readNginxFile(file);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    if (error instanceof NginxError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    console.error("Error in GET /api/nginx/content:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
