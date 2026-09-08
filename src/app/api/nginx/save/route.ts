import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveNginxFile, NginxError } from "@/lib/nginx-service";

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

    const { relativePath, content } = (body as { relativePath?: unknown; content?: unknown }) ?? {};

    if (relativePath === undefined || typeof relativePath !== "string" || relativePath.trim() === "") {
      return NextResponse.json(
        { error: "Missing relativePath" },
        { status: 400 }
      );
    }

    if (content === undefined || content === null) {
      return NextResponse.json(
        { error: "Missing content" },
        { status: 400 }
      );
    }

    const data = await saveNginxFile(relativePath, String(content));
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    if (error instanceof NginxError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    console.error("Error in POST /api/nginx/save:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
