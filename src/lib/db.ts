import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data.db');

declare global {
  var _sqliteDb: Database.Database | undefined;
}

export const db: Database.Database = globalThis._sqliteDb ?? new Database(dbPath);

if (process.env.NODE_ENV !== 'production') {
  globalThis._sqliteDb = db;
}

// Enable WAL mode for performance and concurrency
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    description TEXT,
    linkedPm2Process TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TRIGGER IF NOT EXISTS one_admin_only
  BEFORE INSERT ON users
  BEGIN
    SELECT CASE
      WHEN (SELECT count(*) FROM users) > 0 THEN
        RAISE(ABORT, 'Admin already exists')
    END;
  END;
`);

export interface UserRecord {
  id: number;
  username: string;
  passwordHash: string;
  role: string;
  createdAt?: string;
}

export function adminExists(): boolean {
  try {
    const stmt = db.prepare('SELECT count(*) as count FROM users');
    const result = stmt.get() as { count: number } | undefined;
    return (result?.count ?? 0) > 0;
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

export function createAdmin(username: string, passwordHash: string): boolean {
  try {
    const stmt = db.prepare(`
      INSERT INTO users (username, passwordHash, role)
      SELECT ?, ?, 'admin'
      WHERE NOT EXISTS (SELECT 1 FROM users);
    `);
    const info = stmt.run(username.trim(), passwordHash);
    return info.changes > 0;
  } catch (error) {
    console.error('Error creating admin:', error);
    return false;
  }
}

export function getAdminByUsername(username: string): UserRecord | null {
  try {
    const stmt = db.prepare('SELECT id, username, passwordHash, role, createdAt FROM users WHERE username = ? COLLATE NOCASE');
    const user = stmt.get(username.trim()) as UserRecord | undefined;
    return user ?? null;
  } catch (error) {
    console.error('Error getting admin by username:', error);
    return null;
  }
}

export default db;

export interface ScriptRecord {
  id: number;
  name: string;
  content: string;
  description: string | null;
  linkedPm2Process: string | null;
  createdAt: string;
}
