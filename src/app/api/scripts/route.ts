import { NextResponse } from "next/server";
import { auth } from "@/auth";
import db from "@/lib/db";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const stmt = db.prepare('SELECT * FROM scripts ORDER BY createdAt DESC');
    const scripts = stmt.all();
    return NextResponse.json({ scripts });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { name, content, description, linkedPm2Process } = await req.json();
    if (!name || !content) return NextResponse.json({ error: "Missing name or content" }, { status: 400 });
    
    const stmt = db.prepare('INSERT INTO scripts (name, content, description, linkedPm2Process) VALUES (?, ?, ?, ?)');
    const info = stmt.run(name, content, description || null, linkedPm2Process || null);
    
    return NextResponse.json({ success: true, id: info.lastInsertRowid });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}