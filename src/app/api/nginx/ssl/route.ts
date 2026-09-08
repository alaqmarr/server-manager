import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateSSL } from "@/lib/nginx-service";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    if (!body.domain || !body.email) {
      return NextResponse.json({ error: "Missing domain or email" }, { status: 400 });
    }

    const data = await generateSSL(body.domain, body.email);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: err.statusCode || 500 });
  }
}