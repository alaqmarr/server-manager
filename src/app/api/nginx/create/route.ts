import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createNginxConfig } from "@/lib/nginx-service";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    if (!body.name || !body.template || !body.domain || !body.portOrPath) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const data = await createNginxConfig(body.name, body.template, body.domain, body.portOrPath);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: err.statusCode || 500 });
  }
}