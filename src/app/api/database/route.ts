import { NextResponse } from "next/server";
import { auth } from "@/auth";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    const { action, dbPath, query } = body || {};

    if (!dbPath) return NextResponse.json({ error: "Missing database path" }, { status: 400 });

    const targetPath = path.resolve(/*turbopackIgnore: true*/ dbPath);
    if (!fs.existsSync(/*turbopackIgnore: true*/ targetPath)) {
      return NextResponse.json({ error: "Database file does not exist" }, { status: 404 });
    }

    // Try to connect to SQLite
    let db;
    try {
      db = new Database(targetPath, { fileMustExist: true });
    } catch (e: any) {
      return NextResponse.json({ error: `Cannot open database: ${e.message}` }, { status: 500 });
    }

    try {
      if (action === "connect") {
        // Fetch all tables
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[];
        
        const schema: any = {};
        for (const t of tables) {
          const info = db.prepare(`PRAGMA table_info("${t.name}")`).all();
          schema[t.name] = info;
        }
        
        return NextResponse.json({ success: true, tables: tables.map(t => t.name), schema });
      } else if (action === "query") {
        if (!query) return NextResponse.json({ error: "Empty query" }, { status: 400 });

        const isSelect = query.trim().toUpperCase().startsWith("SELECT") || query.trim().toUpperCase().startsWith("PRAGMA");
        
        let result;
        if (isSelect) {
          result = db.prepare(query).all();
        } else {
          const info = db.prepare(query).run();
          result = [{ changes: info.changes, lastInsertRowid: info.lastInsertRowid.toString() }];
        }

        return NextResponse.json({ success: true, rows: result });
      }
    } finally {
      if (db) db.close();
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
