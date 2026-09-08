const fs = require('fs');
const path = require('path');

let content = fs.readFileSync('src/lib/nginx-service.ts', 'utf8');

// Add isEnabled
content = content.replace('modifiedAt: string;', 'modifiedAt: string;\n  isEnabled?: boolean;');

// Update scanDir to populate isEnabled
const scanDirTarget = esults.push({
            name: entry.name,
            relativePath: relPath,
            size: stats.size,
            modifiedAt: stats.mtime.toISOString(),
          });;
const scanDirReplacement = const isEnabled = relPath.startsWith("sites-available/") ? fs.existsSync(path.join(baseDir, "sites-enabled", entry.name)) : undefined;
          results.push({
            name: entry.name,
            relativePath: relPath,
            size: stats.size,
            modifiedAt: stats.mtime.toISOString(),
            isEnabled,
          });;
content = content.replace(scanDirTarget, scanDirReplacement);

const newFunctions = 
/**
 * Creates a new Nginx configuration file in sites-available.
 */
export async function createNginxConfig(name: string, template: 'proxy' | 'static', domain: string, portOrPath: string): Promise<NginxSaveResponse> {
  const baseDir = getNginxBaseDir();
  const sitesAvailable = path.join(baseDir, 'sites-available');
  if (!fs.existsSync(sitesAvailable)) {
    fs.mkdirSync(sitesAvailable, { recursive: true });
  }

  const safeName = name.replace(/[^a-zA-Z0-9.-]/g, '');
  const filePath = path.join(sitesAvailable, \\\\\\.conf\\\);
  if (fs.existsSync(filePath)) {
    throw new NginxError("Configuration file already exists", 400);
  }

  let content = '';
  if (template === 'proxy') {
    content = \\\server {
    listen 80;
    server_name \\\;

    location / {
        proxy_pass http://127.0.0.1:\\\;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\\\\\;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \\\\\\System.Management.Automation.Internal.Host.InternalHost;
        proxy_cache_bypass \\\\\\;
    }
}\\\;
  } else {
    content = \\\server {
    listen 80;
    server_name \\\;

    root \\\;
    index index.html index.htm;

    location / {
        try_files \\\\\\ \\\\\\/ /index.html;
    }
}\\\;
  }

  fs.writeFileSync(filePath, content, 'utf-8');

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
      if (!fs.existsSync(enabledPath)) {
        await execAsync(\\\sudo -n ln -s \\\ \\\\\\).catch(() => {
          // fallback
          fs.symlinkSync(availablePath, enabledPath);
        });
      }
    } else {
      if (fs.existsSync(enabledPath)) {
        await execAsync(\\\sudo -n rm \\\\\\).catch(() => {
          fs.unlinkSync(enabledPath);
        });
      }
    }
    
    // Attempt to reload nginx
    await execAsync(\\\sudo -n nginx -s reload\\\).catch(() => {});

    return { success: true, message: \\\Site \\\ successfully\\\ };
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
    const { stdout, stderr } = await execAsync(\\\sudo -n certbot --nginx -d \\\ --non-interactive --agree-tos -m \\\\\\);
    return {
      success: true,
      message: "SSL certificate generated successfully",
      output: stdout || stderr,
    };
  } catch (err: any) {
    throw new NginxError(err.message || "Failed to generate SSL certificate", 500);
  }
}
\;

content += newFunctions;
fs.writeFileSync('src/lib/nginx-service.ts', content);
