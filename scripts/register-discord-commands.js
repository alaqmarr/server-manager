const https = require('https');
const fs = require('fs');
const path = require('path');

// Try to parse .env file
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim();
    }
  });
}

const APP_ID = process.env.DISCORD_APP_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!APP_ID || !BOT_TOKEN) {
  console.error("❌ ERROR: Missing DISCORD_APP_ID or DISCORD_BOT_TOKEN in environment variables.");
  console.error("Please add them to your .env file or Nexus Dashboard and try again.");
  process.exit(1);
}

const commands = [
  {
    name: 'status',
    description: 'Get the current health and status of the Nexus server and PM2 apps',
    type: 1 // CHAT_INPUT
  },
  {
    name: 'restart',
    description: 'Restart a specific PM2 app or all apps',
    type: 1,
    options: [{ name: 'app', description: 'Name of the app (or "all")', type: 3, required: true }]
  },
  {
    name: 'start',
    description: 'Start a specific PM2 app',
    type: 1,
    options: [{ name: 'app', description: 'Name of the app', type: 3, required: true }]
  },
  {
    name: 'stop',
    description: 'Stop a specific PM2 app',
    type: 1,
    options: [{ name: 'app', description: 'Name of the app', type: 3, required: true }]
  },
  {
    name: 'flush',
    description: 'Flush logs for a specific PM2 app or all apps',
    type: 1,
    options: [{ name: 'app', description: 'Name of the app (or "all")', type: 3, required: true }]
  },
  {
    name: 'logs',
    description: 'Fetch the latest logs for a PM2 app',
    type: 1,
    options: [{ name: 'app', description: 'Name of the app', type: 3, required: true }]
  }
];

const data = JSON.stringify(commands);

const options = {
  hostname: 'discord.com',
  port: 443,
  path: `/api/v10/applications/${APP_ID}/commands`,
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bot ${BOT_TOKEN}`,
    'Content-Length': Buffer.byteLength(data)
  }
};

console.log("Registering Discord slash commands...");

const req = https.request(options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log("✅ Successfully registered slash commands globally!");
      console.log("It may take up to an hour for Discord to update globally, or you can kick/re-invite the bot.");
    } else {
      console.error(`❌ Failed to register commands (HTTP ${res.statusCode}):`);
      console.error(responseData);
    }
  });
});

req.on('error', (e) => {
  console.error(`❌ Request error: ${e.message}`);
});

req.write(data);
req.end();
