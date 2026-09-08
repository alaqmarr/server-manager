import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { adminExists, createAdmin } from "@/lib/db";

export async function POST(request: Request) {
  try {
    // Enforce one-time admin setup
    if (adminExists()) {
      return NextResponse.json(
        { error: "Admin already exists" },
        { status: 400 }
      );
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

    const { username, password } = (body as { username?: string; password?: string }) ?? {};

    if (!username || typeof username !== "string" || username.trim().length < 3) {
      return NextResponse.json(
        { error: "Username must be at least 3 characters long" },
        { status: 400 }
      );
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters long" },
        { status: 400 }
      );
    }

    // Atomic / double-check to prevent concurrent creation before hashing
    if (adminExists()) {
      return NextResponse.json(
        { error: "Admin already exists" },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Double-check after async bcrypt hash to catch concurrent requests
    if (adminExists()) {
      return NextResponse.json(
        { error: "Admin already exists" },
        { status: 400 }
      );
    }

    const created = createAdmin(username.trim(), passwordHash);

    if (!created) {
      return NextResponse.json(
        { error: "Admin already exists" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: true, message: "Admin created successfully" },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error in POST /api/setup:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
