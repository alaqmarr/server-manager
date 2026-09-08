import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { testNginxSyntax } from "@/lib/nginx-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // Empty or invalid body is acceptable for global test
      body = {};
    }

    const { content, relativePath } =
      (body as { content?: string; relativePath?: string }) ?? {};

    const data = await testNginxSyntax(content, relativePath);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error in POST /api/nginx/test:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
