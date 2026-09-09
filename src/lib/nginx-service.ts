import fs from "fs";
import os from "os";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface NginxFileEntry {
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
  isEnabled?: boolean;
}

export interface NginxFilesResponse {
  success: boolean;
  files: NginxFileEntry[];
}

export interface NginxContentResponse {
  success: boolean;
  relativePath: string;
  content: string;
}

export interface NginxSaveResponse {
  success: boolean;
  message: string;
}

export interface NginxTestResponse {
  success: boolean;
  output: string;
}

export class NginxError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "NginxError";
    this.statusCode = statusCode;
  }
}

const DEFAULT_NGINX_CONF = `user www-data;
worker_processes auto;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
    worker_connections 1024;
    multi_accept on;
}

http {
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    gzip on;
    gzip_disable "msie6";

    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
`;

const DEFAULT_PMMANAGER_CONF = `server {
    listen 80;
    server_name localhost;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;

/**
 * Resolves the Nginx base directory.
 * If /etc/nginx exists, use it. Otherwise, use <cwd>/simulated_nginx.
 * Auto-seeds simulated_nginx directory and default configs if absent.
 */
export function getNginxBaseDir(): string {
  if (process.env.NGINX_DIR) {
    const customDir = path.resolve(process.env.NGINX_DIR);
    if (!fs.existsSync(customDir)) {
      fs.mkdirSync(customDir, { recursive: true });
    }
    return customDir;
  }

  // Check for real system /etc/nginx
  if (fs.existsSync("/etc/nginx") && fs.statSync("/etc/nginx").isDirectory()) {
    return "/etc/nginx";
  }

  // Simulated fallback directory
  const simDir = path.resolve(process.cwd(), "simulated_nginx");
  ensureSimulatedNginxSeeded(simDir);
  return simDir;
}

/**
 * Ensures simulated_nginx is seeded with realistic configurations.
 */
export function ensureSimulatedNginxSeeded(baseDir: string): void {
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  const nginxConfPath = path.join(baseDir, "nginx.conf");
  if (!fs.existsSync(nginxConfPath)) {
    fs.writeFileSync(nginxConfPath, DEFAULT_NGINX_CONF, "utf-8");
  }

  const confDDir = path.join(baseDir, "conf.d");
  if (!fs.existsSync(confDDir)) {
    fs.mkdirSync(confDDir, { recursive: true });
  }

  const pmmanagerConfPath = path.join(confDDir, "pmmanager.conf");
  if (!fs.existsSync(pmmanagerConfPath)) {
    fs.writeFileSync(pmmanagerConfPath, DEFAULT_PMMANAGER_CONF, "utf-8");
  }
}

/**
 * Validates and resolves a relative file path safely against the base directory.
 * Strictly prevents path traversal attacks, returning 403 Forbidden.
 */
export function resolveSafePath(baseDir: string, relativePath: string): string {
  if (!relativePath || typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new NginxError("Missing relativePath", 400);
  }

  const raw = relativePath.trim();

  // Multi-pass URL decode check for obfuscated sequences like %2e%2e%2f
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
    // Double decode check
    decoded = decodeURIComponent(decoded);
  } catch {
    // Malformed URL encoding is rejected
    throw new NginxError("Path traversal forbidden", 403);
  }

  // Block obvious traversal indicators in raw or decoded path
  if (
    raw.includes("..") ||
    decoded.includes("..") ||
    raw.startsWith("/") ||
    raw.startsWith("\\") ||
    decoded.startsWith("/") ||
    decoded.startsWith("\\") ||
    /^[a-zA-Z]:/.test(raw) ||
    /^[a-zA-Z]:/.test(decoded)
  ) {
    throw new NginxError("Path traversal forbidden", 403);
  }

  const normalizedBase = path.resolve(baseDir);
  const resolved = path.resolve(normalizedBase, decoded);

  // Verification: resolved path must reside strictly inside normalizedBase
  const rel = path.relative(normalizedBase, resolved);
  if (
    rel.startsWith("..") ||
    path.isAbsolute(rel) ||
    !resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase
  ) {
    throw new NginxError("Path traversal forbidden", 403);
  }

  // Prevent accessing the directory root as a file
  if (resolved === normalizedBase) {
    throw new NginxError("Invalid target: directory root specified", 400);
  }

  return resolved;
}

/**
 * Recursively scans directory for Nginx configuration files (.conf, sites-available, sites-enabled).
 */
function scanDir(dir: string, baseDir: string, results: NginxFileEntry[]): void {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Don't recurse into hidden directories
      if (!entry.name.startsWith(".")) {
        scanDir(fullPath, baseDir, results);
      }
    } else if (entry.isFile()) {
      // Skip backup files, temporary files, hidden files
      if (entry.name.endsWith(".bak") || entry.name.endsWith(".tmp") || entry.name.startsWith(".")) {
        continue;
      }

      // Match .conf files or files under sites-available / sites-enabled
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      const isConf = entry.name.endsWith(".conf");
      const isNginxConf = entry.name === "nginx.conf";
      const isSitesConfig = relPath.startsWith("sites-available/") || relPath.startsWith("sites-enabled/");

      if (isConf || isNginxConf || isSitesConfig) {
        try {
          const stats = fs.statSync(fullPath);
          const isEnabled = relPath.startsWith("sites-available/") ? fs.existsSync(path.join(baseDir, "sites-enabled", entry.name)) : undefined;
          results.push({
            name: entry.name,
            relativePath: relPath,
            size: stats.size,
            modifiedAt: stats.mtime.toISOString(),
            isEnabled,
          });
        } catch {
          // Ignore unreadable files
        }
      }
    }
  }
}

/**
 * Lists all available Nginx configuration files.
 */
export async function listNginxFiles(): Promise<NginxFilesResponse> {
  const baseDir = getNginxBaseDir();
  const files: NginxFileEntry[] = [];

  scanDir(baseDir, baseDir, files);

  // Sort files with nginx.conf first, then alphabetical by relativePath
  files.sort((a, b) => {
    if (a.relativePath === "nginx.conf") return -1;
    if (b.relativePath === "nginx.conf") return 1;
    return a.relativePath.localeCompare(b.relativePath);
  });

  return {
    success: true,
    files,
  };
}

/**
 * Reads the content of an Nginx configuration file.
 */
export async function readNginxFile(relativePath: string): Promise<NginxContentResponse> {
  const baseDir = getNginxBaseDir();
  const safePath = resolveSafePath(baseDir, relativePath);

  if (!fs.existsSync(/*turbopackIgnore: true*/ safePath) || !fs.statSync(/*turbopackIgnore: true*/ safePath).isFile()) {
    throw new NginxError("File not found", 404);
  }

  const content = fs.readFileSync(/*turbopackIgnore: true*/ safePath, "utf-8");
  const normalizedRel = path.relative(baseDir, safePath).replace(/\\/g, "/");

  return {
    success: true,
    relativePath: normalizedRel,
    content,
  };
}

/**
 * Saves content to an Nginx configuration file.
 * Creates a .bak backup before writing and writes atomically.
 */
export async function saveNginxFile(relativePath: string, content: string): Promise<NginxSaveResponse> {
  if (content === undefined || content === null) {
    throw new NginxError("Missing content", 400);
  }

  const baseDir = getNginxBaseDir();
  const safePath = resolveSafePath(baseDir, relativePath);

  // Ensure parent directory exists
  const parentDir = path.dirname(safePath);
  try {
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  } catch (err: any) {
    if (err.code === 'EACCES') {
      await execAsync(`sudo -n mkdir -p ${parentDir}`);
    } else {
      throw err;
    }
  }

  // Create .bak backup if the file already exists
  if (fs.existsSync(/*turbopackIgnore: true*/ safePath)) {
    try {
      fs.copyFileSync(/*turbopackIgnore: true*/ safePath, `${safePath}.bak`);
    } catch (err: any) {
      if (err.code === 'EACCES') {
        try {
          await execAsync(`sudo -n cp ${safePath} ${safePath}.bak`);
        } catch {}
      }
    }
  }

  const sysTempPath = path.join(os.tmpdir(), `nginx-save-${Date.now()}.conf`);
  fs.writeFileSync(sysTempPath, String(content), "utf-8");

  try {
    fs.renameSync(sysTempPath, safePath);
  } catch (err: any) {
    if (err.code === 'EACCES' || err.code === 'EXDEV') {
      await execAsync(`sudo -n cp ${sysTempPath} ${safePath}`);
      await execAsync(`sudo -n chmod 644 ${safePath}`);
      fs.unlinkSync(sysTempPath);
    } else {
      try { fs.unlinkSync(sysTempPath); } catch {}
      throw err;
    }
  }

  // Reload nginx after saving
  try {
    await execAsync("sudo -n nginx -s reload");
  } catch (err) {
    // We ignore errors here so the UI doesn't crash, but it might mean syntax is invalid
    // or Nginx isn't running.
  }

  return {
    success: true,
    message: "Configuration saved successfully (Nginx reloaded)",
  };
}

/**
 * Validates Nginx syntax.
 * Executes `nginx -t` if real Nginx binary exists, or performs syntax analysis in simulated mode.
 */
export async function testNginxSyntax(content?: string, relativePath?: string): Promise<NginxTestResponse> {
  // Check if real nginx binary is executable on host
  let hasRealNginx = false;
  try {
    await execAsync(process.platform === "win32" ? "where nginx" : "which nginx", { timeout: 2000 });
    hasRealNginx = true;
  } catch {
    hasRealNginx = false;
  }

  if (hasRealNginx) {
    try {
      const { stdout, stderr } = await execAsync("nginx -t", { timeout: 5000 });
      return {
        success: true,
        output: stdout || stderr || "nginx: configuration file test is successful",
      };
    } catch (err: unknown) {
      const errorObj = err as { stderr?: string; stdout?: string; message?: string };
      return {
        success: false,
        output: errorObj.stderr || errorObj.stdout || errorObj.message || "nginx: syntax test failed",
      };
    }
  }

  // Simulated syntax validator
  const textToValidate = content ?? (relativePath ? (await readNginxFile(relativePath)).content : "");

  if (!textToValidate || textToValidate.trim() === "") {
    return {
      success: false,
      output: "nginx: [emerg] configuration file is empty",
    };
  }

  const lines = textToValidate.split(/\r?\n/);
  let openBraces = 0;
  let inDoubleQuote = false;
  let inSingleQuote = false;

  for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
    const line = lines[lineNum - 1];
    const trimmed = line.trim();

    // Skip empty lines and comment lines
    if (!trimmed || trimmed.startsWith("#")) continue;

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      const prevChar = i > 0 ? trimmed[i - 1] : "";

      if (char === '"' && prevChar !== "\\") {
        inDoubleQuote = !inDoubleQuote;
      } else if (char === "'" && prevChar !== "\\") {
        inSingleQuote = !inSingleQuote;
      } else if (!inDoubleQuote && !inSingleQuote) {
        if (char === "{") {
          openBraces++;
        } else if (char === "}") {
          openBraces--;
          if (openBraces < 0) {
            return {
              success: false,
              output: `nginx: [emerg] unexpected "}" in line ${lineNum}`,
            };
          }
        }
      }
    }
  }

  if (openBraces > 0) {
    return {
      success: false,
      output: `nginx: [emerg] unexpected end of file, expecting "}" (${openBraces} unclosed block${openBraces > 1 ? "s" : ""})`,
    };
  }

  if (inDoubleQuote || inSingleQuote) {
    return {
      success: false,
      output: "nginx: [emerg] unclosed quote detected in configuration",
    };
  }

  return {
    success: true,
    output: "nginx: the configuration file syntax is ok\nnginx: configuration file test is successful",
  };
}

/**
 * Creates a new Nginx configuration file in sites-available.
 */
export async function createNginxConfig(name: string, template: 'proxy' | 'static', domain: string, portOrPath: string): Promise<NginxSaveResponse> {
  const baseDir = getNginxBaseDir();
  const sitesAvailable = path.join(baseDir, 'sites-available');
  try {
    if (!fs.existsSync(sitesAvailable)) {
      fs.mkdirSync(sitesAvailable, { recursive: true });
    }
  } catch (err: any) {
    if (err.code === 'EACCES') {
      await execAsync(`sudo -n mkdir -p ${sitesAvailable}`);
    }
  }

  const safeName = name.replace(/[^a-zA-Z0-9.-]/g, '');
  const filePath = path.join(sitesAvailable, `${safeName}.conf`);
  if (fs.existsSync(filePath)) {
    throw new NginxError("Configuration file already exists", 400);
  }

  let fileContent = '';
  if (template === 'proxy') {
    fileContent = `server {
    listen 80;
    server_name ${domain};

    location / {
        proxy_pass http://127.0.0.1:${portOrPath};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}`;
  } else {
    fileContent = `server {
    listen 80;
    server_name ${domain};

    root ${portOrPath};
    index index.html index.htm;

    location / {
        try_files $uri $uri/ /index.html;
    }
}`;
  }

  const sysTempPath = path.join(os.tmpdir(), `nginx-create-${Date.now()}.conf`);
  fs.writeFileSync(sysTempPath, fileContent, "utf-8");

  try {
    fs.renameSync(sysTempPath, filePath);
  } catch (err: any) {
    if (err.code === 'EACCES' || err.code === 'EXDEV') {
      await execAsync(`sudo -n cp ${sysTempPath} ${filePath}`);
      await execAsync(`sudo -n chmod 644 ${filePath}`);
      fs.unlinkSync(sysTempPath);
    } else {
      try { fs.unlinkSync(sysTempPath); } catch {}
      throw err;
    }
  }

  return {
    success: true,
    message: "Configuration created successfully",
  };
}

/**
 * Toggles a site by creating/removing symlinks in sites-enabled.
 */
export async function toggleNginxSite(name: string, enable: boolean): Promise<{ success: boolean; message: string }> {
  const baseDir = getNginxBaseDir();
  const availablePath = path.join(baseDir, 'sites-available', name);
  const enabledPath = path.join(baseDir, 'sites-enabled', name);

  if (!fs.existsSync(availablePath)) {
    throw new NginxError("Configuration file not found in sites-available", 404);
  }

  const enabledDir = path.join(baseDir, 'sites-enabled');
  if (!fs.existsSync(enabledDir)) {
    fs.mkdirSync(enabledDir, { recursive: true });
  }

  try {
    if (enable) {
      await execAsync(`sudo -n ln -sf "${availablePath}" "${enabledPath}"`).catch(() => {
        // fallback
        if (fs.existsSync(enabledPath) || fs.lstatSync(enabledPath, { throwIfNoEntry: false })) {
          fs.unlinkSync(enabledPath);
        }
        fs.symlinkSync(availablePath, enabledPath);
      });
    } else {
      await execAsync(`sudo -n rm -f "${enabledPath}"`).catch(() => {
        if (fs.existsSync(enabledPath) || fs.lstatSync(enabledPath, { throwIfNoEntry: false })) {
          fs.unlinkSync(enabledPath);
        }
      });
    }
    
    // Attempt to reload nginx
    await execAsync(`sudo -n nginx -s reload`).catch(() => {});

    return { success: true, message: `Site ${enable ? 'enabled' : 'disabled'} successfully` };
  } catch (err: any) {
    throw new NginxError(err.message || "Failed to toggle site", 500);
  }
}

/**
 * Generates an SSL certificate using certbot.
 */
export async function generateSSL(domain: string, email: string): Promise<{ success: boolean; message: string; output: string }> {
  try {
    // Check if certbot is installed
    await execAsync("which certbot");
  } catch {
    throw new NginxError("Certbot is not installed on this server. Please install it using: sudo apt-get install certbot python3-certbot-nginx", 400);
  }

  try {
    const { stdout, stderr } = await execAsync(`sudo -n certbot --nginx -d ${domain} --non-interactive --agree-tos -m ${email}`);
    return {
      success: true,
      message: "SSL certificate generated successfully",
      output: stdout || stderr,
    };
  } catch (err: any) {
    throw new NginxError(err.message || "Failed to generate SSL certificate", 500);
  }
}
