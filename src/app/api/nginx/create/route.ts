import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import { createNginxConfig } from "@/lib/nginx-service";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const authResult = await requireAdmin(req);
    if (authResult.error) {
      return authResult.error;
    }

    const body = await req.json();
    if (!body.name || !body.template || !body.domain || !body.portOrPath) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const data = await createNginxConfig(body.name, body.template, body.domain, body.portOrPath);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const error = err as { message?: string; statusCode?: number };
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: error?.statusCode || 500 }
    );
  }
}