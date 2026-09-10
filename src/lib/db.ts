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

// Enable WAL mode for performance and concurrency, and enable foreign keys
db.pragma('journal_mode = WAL');

// 🚨 Auto-Migration: Add 'client' role and 'allowedProcess' column
try {
  const tableInfo = db.pragma('table_info(users)') as any[];
  if (tableInfo.length > 0) { // Table exists
    const hasAllowedProcess = tableInfo.some(col => col.name === 'allowedProcess');
    if (!hasAllowedProcess) {
      console.log("[DB] Migrating users table to support clients...");
      db.pragma('foreign_keys = OFF');
      db.exec(`
        BEGIN TRANSACTION;
        CREATE TABLE users_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL COLLATE NOCASE,
          passwordHash TEXT NOT NULL,
          role TEXT CHECK(role IN ('admin', 'developer', 'client')) NOT NULL DEFAULT 'admin',
          allowedProcess TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users_v2 (id, username, passwordHash, role, createdAt)
        SELECT id, username, passwordHash, role, createdAt FROM users;
        DROP TABLE users;
        ALTER TABLE users_v2 RENAME TO users;
        COMMIT;
      `);
      db.pragma('foreign_keys = ON');
    }
  }
} catch (e) {
  console.error("[DB] Migration failed:", e);
}

db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    passwordHash TEXT NOT NULL,
    role TEXT CHECK(role IN ('admin', 'developer', 'client')) NOT NULL DEFAULT 'admin',
    allowedProcess TEXT,
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

  CREATE TABLE IF NOT EXISTS pm2_vitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    process TEXT NOT NULL,
    cpu REAL NOT NULL,
    memory INTEGER NOT NULL,
    timestamp TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_pm2_vitals_process_time ON pm2_vitals(process, timestamp);

  CREATE TABLE IF NOT EXISTS uptime_monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    intervalSeconds INTEGER NOT NULL DEFAULT 60,
    status TEXT NOT NULL DEFAULT 'PENDING',
    uptimePercentage REAL DEFAULT 100.0,
    lastCheck TEXT,
    lastResponseTime INTEGER DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS uptime_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitorId INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('UP', 'DOWN')),
    statusCode INTEGER,
    responseTime INTEGER NOT NULL,
    error TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (monitorId) REFERENCES uptime_monitors(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_uptime_checks_monitor ON uptime_checks(monitorId, timestamp);

  DROP TRIGGER IF EXISTS one_admin_only;

  CREATE TRIGGER IF NOT EXISTS one_admin_only
  BEFORE INSERT ON users
  WHEN LOWER(NEW.role) = 'admin' AND (SELECT count(*) FROM users WHERE LOWER(role) = 'admin') > 0
  BEGIN
    SELECT RAISE(ABORT, 'Only one administrator account is permitted');
  END;

  DROP TRIGGER IF EXISTS one_admin_only_update;

  CREATE TRIGGER IF NOT EXISTS one_admin_only_update
  BEFORE UPDATE OF role ON users
  WHEN LOWER(NEW.role) = 'admin' AND LOWER(OLD.role) != 'admin' AND (SELECT count(*) FROM users WHERE LOWER(role) = 'admin') > 0
  BEGIN
    SELECT RAISE(ABORT, 'Only one administrator account is permitted');
  END;

  DROP TRIGGER IF EXISTS prevent_last_admin_demote;

  CREATE TRIGGER IF NOT EXISTS prevent_last_admin_demote
  BEFORE UPDATE OF role ON users
  WHEN LOWER(OLD.role) = 'admin' AND LOWER(NEW.role) != 'admin' AND (SELECT count(*) FROM users WHERE LOWER(role) = 'admin') <= 1
  BEGIN
    SELECT RAISE(ABORT, 'Cannot demote the last remaining administrator');
  END;

  DROP TRIGGER IF EXISTS prevent_last_admin_delete;

  CREATE TRIGGER IF NOT EXISTS prevent_last_admin_delete
  BEFORE DELETE ON users
  WHEN LOWER(OLD.role) = 'admin' AND (SELECT count(*) FROM users WHERE LOWER(role) = 'admin') <= 1
  BEGIN
    SELECT RAISE(ABORT, 'Cannot delete the last remaining administrator');
  END;
`);

// Migration helper: ensure role column exists in users table for legacy databases
try {
  const userColumns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userColumns.some((col) => col.name === "role")) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT CHECK(role IN ('admin', 'developer')) NOT NULL DEFAULT 'admin'");
  }
} catch {
  // Ignored if table doesn't exist yet or column already exists
}

export interface UserRecord {
  id: number;
  username: string;
  passwordHash: string;
  role: "admin" | "developer" | "client" | string;
  allowedProcess?: string;
  createdAt?: string;
}

export function adminExists(): boolean {
  try {
    const stmt = db.prepare("SELECT count(*) as count FROM users WHERE LOWER(role) = 'admin'");
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
      VALUES (?, ?, 'admin');
    `);
    const info = stmt.run(username.trim(), passwordHash);
    return info.changes > 0;
  } catch (error) {
    console.error('Error creating admin:', error);
    return false;
  }
}

export function createUser(username: string, passwordHash: string, role: string = 'developer', allowedProcess?: string): boolean {
  try {
    const normalizedRole = role.toLowerCase() === 'admin' ? 'admin' : (role.toLowerCase() === 'client' ? 'client' : 'developer');
    const stmt = db.prepare(`
      INSERT INTO users (username, passwordHash, role, allowedProcess)
      VALUES (?, ?, ?, ?);
    `);
    const info = stmt.run(username.trim(), passwordHash, normalizedRole, allowedProcess || null);
    return info.changes > 0;
  } catch (error) {
    console.error('Error creating user:', error);
    return false;
  }
}

export function getUserByUsername(username: string): UserRecord | null {
  try {
    const stmt = db.prepare('SELECT id, username, passwordHash, role, allowedProcess, createdAt FROM users WHERE username = ? COLLATE NOCASE');
    const user = stmt.get(username.trim()) as UserRecord | undefined;
    return user ?? null;
  } catch (error) {
    console.error('Error fetching user by username:', error);
    return null;
  }
}

// Alias for backwards compatibility
export const getAdminByUsername = getUserByUsername;

export function listUsers(): Omit<UserRecord, 'passwordHash'>[] {
  try {
    const stmt = db.prepare('SELECT id, username, role, allowedProcess, createdAt FROM users ORDER BY id ASC');
    return (stmt.all() as Omit<UserRecord, 'passwordHash'>[]) ?? [];
  } catch (error) {
    console.error('Error listing users:', error);
    return [];
  }
}

export function updateUserRole(id: number, role: string): boolean {
  try {
    const normalizedRole = role.toLowerCase() === 'admin' ? 'admin' : 'developer';
    const targetUser = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined;
    if (!targetUser) return false;

    // Prevent demoting the last remaining administrator
    if (targetUser.role.toLowerCase() === 'admin' && normalizedRole !== 'admin') {
      const adminCountStmt = db.prepare("SELECT count(*) as count FROM users WHERE LOWER(role) = 'admin'");
      const adminCount = (adminCountStmt.get() as { count: number }).count;
      if (adminCount <= 1) {
        console.error('Cannot demote the last remaining administrator');
        return false;
      }
    }

    const stmt = db.prepare('UPDATE users SET role = ? WHERE id = ?');
    const info = stmt.run(normalizedRole, id);
    return info.changes > 0;
  } catch (error) {
    console.error('Error updating user role:', error);
    return false;
  }
}

export function deleteUser(id: number): boolean {
  try {
    // Check if target is the only admin
    const targetUser = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined;
    if (!targetUser) return false;

    if (targetUser.role.toLowerCase() === 'admin') {
      const adminCountStmt = db.prepare("SELECT count(*) as count FROM users WHERE LOWER(role) = 'admin'");
      const adminCount = (adminCountStmt.get() as { count: number }).count;
      if (adminCount <= 1) {
        throw new Error('Cannot delete the last remaining administrator');
      }
    }

    const stmt = db.prepare('DELETE FROM users WHERE id = ?');
    const info = stmt.run(id);
    return info.changes > 0;
  } catch (error) {
    console.error('Error deleting user:', error);
    return false;
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

export interface PmVitalRecord {
  id?: number;
  process: string;
  processName: string;
  processId: string;
  cpu: number;
  memory: number;
  timestamp: string;
}

export interface UptimeMonitorRecord {
  id: number;
  name: string;
  url: string;
  intervalSeconds: number;
  status: 'UP' | 'DOWN' | 'PENDING' | string;
  lastStatus?: 'UP' | 'DOWN' | 'PENDING';
  uptimePercentage: number;
  lastCheck: string | null;
  lastResponseTime: number;
  avgResponseTimeMs: number;
  createdAt: string;
}

export interface UptimeCheckRecord {
  id: number;
  monitorId: number;
  status: 'UP' | 'DOWN';
  statusCode: number | null;
  responseTime: number;
  responseTimeMs: number;
  error?: string | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Vitals Helpers
// ---------------------------------------------------------------------------

export function recordVital(
  processName: string,
  cpu: number,
  memory: number,
  timestamp?: string
): PmVitalRecord {
  const ts = timestamp || new Date().toISOString();
  const normalizedProcess = processName.trim();
  const stmt = db.prepare(`
    INSERT INTO pm2_vitals (process, cpu, memory, timestamp)
    VALUES (?, ?, ?, ?)
  `);
  const info = stmt.run(normalizedProcess, Number(cpu), Math.round(Number(memory)), ts);
  const id = Number(info.lastInsertRowid);

  return {
    id,
    process: normalizedProcess,
    processName: normalizedProcess,
    processId: String(id),
    cpu: Number(cpu),
    memory: Math.round(Number(memory)),
    timestamp: ts,
  };
}

export function getVitalsHistory(
  processName?: string,
  hours: number = 24
): PmVitalRecord[] {
  try {
    const validHours = isNaN(hours) || hours <= 0 ? 24 : hours;
    const cutoff = new Date(Date.now() - validHours * 3600 * 1000).toISOString();

    let rows: any[];
    if (processName && processName.trim() !== '') {
      const stmt = db.prepare(`
        SELECT id, process, cpu, memory, timestamp
        FROM pm2_vitals
        WHERE process = ? AND timestamp >= ?
        ORDER BY timestamp ASC
      `);
      rows = stmt.all(processName.trim(), cutoff);
    } else {
      const stmt = db.prepare(`
        SELECT id, process, cpu, memory, timestamp
        FROM pm2_vitals
        WHERE timestamp >= ?
        ORDER BY timestamp ASC
      `);
      rows = stmt.all(cutoff);
    }

    return rows.map((r: any) => ({
      id: r.id,
      process: r.process,
      processName: r.process,
      processId: String(r.id),
      cpu: Number(r.cpu),
      memory: Number(r.memory),
      timestamp: r.timestamp,
    }));
  } catch (error) {
    console.error('Error fetching vitals history:', error);
    return [];
  }
}

export function getVitalsCount(processName?: string): number {
  try {
    if (processName && processName.trim() !== '') {
      const stmt = db.prepare('SELECT count(*) as count FROM pm2_vitals WHERE process = ?');
      const res = stmt.get(processName.trim()) as { count: number };
      return res?.count ?? 0;
    }
    const stmt = db.prepare('SELECT count(*) as count FROM pm2_vitals');
    const res = stmt.get() as { count: number };
    return res?.count ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Uptime Helpers
// ---------------------------------------------------------------------------

function formatMonitorRow(row: any): UptimeMonitorRecord {
  const percentage =
    typeof row.uptimePercentage === 'number' && !isNaN(row.uptimePercentage)
      ? Number(row.uptimePercentage)
      : 100.0;
  const status =
    row.status === 'UP' || row.status === 'DOWN' ? row.status : row.status || 'PENDING';
  const lastResponseTime =
    typeof row.lastResponseTime === 'number' ? row.lastResponseTime : 0;

  return {
    id: row.id,
    name: row.name,
    url: row.url,
    intervalSeconds: Number(row.intervalSeconds) || 60,
    status,
    lastStatus: status === 'UP' || status === 'DOWN' ? status : undefined,
    uptimePercentage: percentage,
    lastCheck: row.lastCheck ?? null,
    lastResponseTime,
    avgResponseTimeMs: lastResponseTime,
    createdAt: row.createdAt || new Date().toISOString(),
  };
}

export function createUptimeMonitor(
  name: string,
  url: string,
  intervalSeconds: number = 60
): UptimeMonitorRecord {
  const validInterval = intervalSeconds > 0 ? intervalSeconds : 60;
  const stmt = db.prepare(`
    INSERT INTO uptime_monitors (name, url, intervalSeconds, status, uptimePercentage, lastCheck, lastResponseTime)
    VALUES (?, ?, ?, 'PENDING', 100.0, NULL, 0)
  `);
  const info = stmt.run(name.trim(), url.trim(), validInterval);
  const id = Number(info.lastInsertRowid);
  const row = db.prepare('SELECT * FROM uptime_monitors WHERE id = ?').get(id) as any;
  return formatMonitorRow(row);
}

export function getUptimeMonitors(): UptimeMonitorRecord[] {
  try {
    const stmt = db.prepare('SELECT * FROM uptime_monitors ORDER BY id ASC');
    const rows = stmt.all() as any[];
    return rows.map(formatMonitorRow);
  } catch (error) {
    console.error('Error fetching uptime monitors:', error);
    return [];
  }
}

export function getUptimeMonitorById(id: number): UptimeMonitorRecord | null {
  try {
    const stmt = db.prepare('SELECT * FROM uptime_monitors WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? formatMonitorRow(row) : null;
  } catch (error) {
    console.error('Error fetching uptime monitor by id:', error);
    return null;
  }
}

export function updateUptimeMonitor(
  id: number,
  updates: Partial<{
    name: string;
    url: string;
    intervalSeconds: number;
    status: string;
    uptimePercentage: number;
    lastCheck: string | null;
    lastResponseTime: number;
  }>
): boolean {
  try {
    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name.trim());
    }
    if (updates.url !== undefined) {
      setClauses.push('url = ?');
      values.push(updates.url.trim());
    }
    if (updates.intervalSeconds !== undefined) {
      setClauses.push('intervalSeconds = ?');
      values.push(Math.max(1, updates.intervalSeconds));
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.uptimePercentage !== undefined) {
      setClauses.push('uptimePercentage = ?');
      values.push(updates.uptimePercentage);
    }
    if (updates.lastCheck !== undefined) {
      setClauses.push('lastCheck = ?');
      values.push(updates.lastCheck);
    }
    if (updates.lastResponseTime !== undefined) {
      setClauses.push('lastResponseTime = ?');
      values.push(updates.lastResponseTime);
    }

    if (setClauses.length === 0) return true;

    values.push(id);
    const stmt = db.prepare(`UPDATE uptime_monitors SET ${setClauses.join(', ')} WHERE id = ?`);
    const info = stmt.run(...values);
    return info.changes > 0;
  } catch (error) {
    console.error('Error updating uptime monitor:', error);
    return false;
  }
}

export function deleteUptimeMonitor(id: number): boolean {
  try {
    // Explicit cascading delete for safety
    db.prepare('DELETE FROM uptime_checks WHERE monitorId = ?').run(id);
    const info = db.prepare('DELETE FROM uptime_monitors WHERE id = ?').run(id);
    return info.changes > 0;
  } catch (error) {
    console.error('Error deleting uptime monitor:', error);
    return false;
  }
}

export function recordUptimeCheck(check: {
  monitorId: number;
  status: 'UP' | 'DOWN';
  statusCode?: number | null;
  responseTime: number;
  error?: string | null;
  timestamp?: string;
}): UptimeCheckRecord {
  const ts = check.timestamp || new Date().toISOString();
  const statusCode = check.statusCode !== undefined ? check.statusCode : null;
  const error = check.error || null;
  const responseTime = Math.max(0, Math.round(check.responseTime));

  const stmt = db.prepare(`
    INSERT INTO uptime_checks (monitorId, status, statusCode, responseTime, error, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(check.monitorId, check.status, statusCode, responseTime, error, ts);
  const id = Number(info.lastInsertRowid);

  return {
    id,
    monitorId: check.monitorId,
    status: check.status,
    statusCode: statusCode ?? 0,
    responseTime,
    responseTimeMs: responseTime,
    error,
    timestamp: ts,
  };
}

export function getUptimeChecks(monitorId: number, limit: number = 50): UptimeCheckRecord[] {
  try {
    const stmt = db.prepare(`
      SELECT id, monitorId, status, statusCode, responseTime, error, timestamp
      FROM uptime_checks
      WHERE monitorId = ?
      ORDER BY id DESC
      LIMIT ?
    `);
    const rows = stmt.all(monitorId, limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      monitorId: r.monitorId,
      status: r.status as 'UP' | 'DOWN',
      statusCode: r.statusCode,
      responseTime: r.responseTime,
      responseTimeMs: r.responseTime,
      error: r.error,
      timestamp: r.timestamp,
    }));
  } catch (error) {
    console.error('Error fetching uptime checks:', error);
    return [];
  }
}

export function recalculateMonitorSLA(monitorId: number): {
  uptimePercentage: number;
  avgResponseTimeMs: number;
  lastStatus: 'UP' | 'DOWN' | 'PENDING';
  lastCheck: string | null;
  lastResponseTime: number;
} | null {
  try {
    const totalRow = db
      .prepare('SELECT count(*) as total, avg(responseTime) as avgTime FROM uptime_checks WHERE monitorId = ?')
      .get(monitorId) as { total: number; avgTime: number | null } | undefined;
    const total = totalRow?.total ?? 0;

    if (total === 0) {
      const defaultSLA = {
        uptimePercentage: 100.0,
        avgResponseTimeMs: 0,
        lastStatus: 'PENDING' as const,
        lastCheck: null,
        lastResponseTime: 0,
      };
      db.prepare(`
        UPDATE uptime_monitors
        SET uptimePercentage = 100.0,
            status = 'PENDING',
            lastResponseTime = 0
        WHERE id = ?
      `).run(monitorId);
      return defaultSLA;
    }

    const upRow = db
      .prepare("SELECT count(*) as upCount FROM uptime_checks WHERE monitorId = ? AND status = 'UP'")
      .get(monitorId) as { upCount: number } | undefined;
    const upCount = upRow?.upCount ?? 0;

    const latestCheck = db
      .prepare('SELECT status, responseTime, timestamp FROM uptime_checks WHERE monitorId = ? ORDER BY id DESC LIMIT 1')
      .get(monitorId) as { status: string; responseTime: number; timestamp: string } | undefined;

    const rawPercentage = (upCount / total) * 100;
    const uptimePercentage = Number(rawPercentage.toFixed(2));
    const avgResponseTimeMs = Number((totalRow?.avgTime ?? 0).toFixed(1));
    const lastStatus = (latestCheck?.status === 'UP' ? 'UP' : 'DOWN') as 'UP' | 'DOWN';
    const lastCheck = latestCheck?.timestamp || new Date().toISOString();
    const lastResponseTime = latestCheck?.responseTime || 0;

    db.prepare(`
      UPDATE uptime_monitors
      SET uptimePercentage = ?,
          status = ?,
          lastCheck = ?,
          lastResponseTime = ?
      WHERE id = ?
    `).run(uptimePercentage, lastStatus, lastCheck, lastResponseTime, monitorId);

    return {
      uptimePercentage,
      avgResponseTimeMs,
      lastStatus,
      lastCheck,
      lastResponseTime,
    };
  } catch (error) {
    console.error('Error recalculating monitor SLA:', error);
    return null;
  }
}

// Auto-start background workers when running in Node environment
if (typeof window === 'undefined') {
  setTimeout(() => {
    import('./vitals-worker')
      .then((m) => m.startVitalsWorker())
      .catch(() => {});
    import('./uptime-service')
      .then((m) => m.startUptimeWorker())
      .catch(() => {});
  }, 10);
}

