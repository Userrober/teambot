#!/usr/bin/env node
// bin/teambot.js — Global CLI entry point for TeamBot
// Usage: npm install -g teambot && teambot

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const readline = require('readline');
const http = require('http');

const HOME = process.env.HOME || process.env.USERPROFILE;
const TEAMBOT_DIR = path.join(HOME, '.teambot');
const CONFIG_FILE = path.join(TEAMBOT_DIR, 'config.json');
const PID_FILE = path.join(TEAMBOT_DIR, '.teambot.pids');
const TUNNEL_LOG = path.join(TEAMBOT_DIR, '.tunnel.log');
const BOT_LOG = path.join(TEAMBOT_DIR, '.bot.log');
const PKG_DIR = path.resolve(__dirname, '..');
const APP_PKG_DIR = path.join(PKG_DIR, 'appPackage');
const BOT_PORT = '3978';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function checkPrerequisites() {
  // Check Claude CLI
  try {
    execSync(process.platform === 'win32' ? 'claude.cmd --version' : 'claude --version', { stdio: 'ignore' });
    console.log('  Claude CLI: found');
  } catch {
    console.log('  Claude CLI: not found, installing...');
    try {
      execSync('npm install -g @anthropic-ai/claude-code', { stdio: 'inherit' });
      console.log('  Claude CLI: installed');
    } catch {
      console.log('ERROR: Failed to install Claude CLI.');
      console.log('Try manually: npm install -g @anthropic-ai/claude-code');
      process.exit(1);
    }
  }

  // Check Dev Tunnel CLI
  try {
    execSync('devtunnel --version', { stdio: 'ignore' });
    console.log('  Dev Tunnel CLI: found');
  } catch {
    console.log('  Dev Tunnel CLI: not found, installing...');
    try {
      if (process.platform === 'win32') {
        execSync('winget install Microsoft.devtunnel --accept-source-agreements --accept-package-agreements', { stdio: 'inherit' });
      } else if (process.platform === 'darwin') {
        execSync('brew install --cask devtunnel', { stdio: 'inherit' });
      } else {
        execSync('curl -sL https://aka.ms/DevTunnelCliInstall | bash', { stdio: 'inherit' });
      }
      console.log('  Dev Tunnel CLI: installed');
    } catch {
      console.log('ERROR: Failed to install Dev Tunnel CLI.');
      if (process.platform === 'win32') {
        console.log('Try manually: winget install Microsoft.devtunnel');
      } else {
        console.log('Try manually: https://aka.ms/devtunnels/download');
      }
      process.exit(1);
    }
  }

  // Check devtunnel login
  try {
    const list = execSync('devtunnel list', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  } catch {
    console.log('  Dev Tunnel: not logged in, please login...');
    try {
      execSync('devtunnel user login', { stdio: 'inherit' });
      console.log('  Dev Tunnel: logged in');
    } catch {
      console.log('ERROR: Dev Tunnel login failed.');
      console.log('Try manually: devtunnel user login');
      process.exit(1);
    }
  }
}

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {}
  }
  return null;
}

function saveConfig(config) {
  ensureDir(TEAMBOT_DIR);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function configure() {
  console.log('');
  console.log('=== TeamBot Setup ===');
  console.log('');
  console.log('You need a Bot registered in the Teams Developer Portal.');
  console.log('  https://dev.teams.microsoft.com/bots');
  console.log('');

  const botId = await ask('Bot ID: ');
  if (!botId) { console.log('ERROR: Bot ID is required.'); process.exit(1); }

  const clientSecret = await ask('Client Secret: ');
  if (!clientSecret) { console.log('ERROR: Client Secret is required.'); process.exit(1); }

  const tenantId = await ask('Tenant ID: ');
  if (!tenantId) {
    console.log('ERROR: Tenant ID is required.');
    console.log('  Find it at: Azure Portal > Azure Active Directory > Overview > Tenant ID');
    process.exit(1);
  }

  const config = { botId, clientSecret, tenantId };
  saveConfig(config);
  console.log('');
  console.log('Config saved to ' + CONFIG_FILE);

  // Package Teams App
  packageApp(botId);

  return config;
}

function packageApp(botId) {
  console.log('');
  console.log('Packaging Teams App...');

  const buildDir = path.join(TEAMBOT_DIR, 'appPackage');
  ensureDir(buildDir);

  const manifestSrc = path.join(APP_PKG_DIR, 'manifest.json');
  if (!fs.existsSync(manifestSrc)) {
    console.log('WARNING: manifest.json not found. Skipping app packaging.');
    return;
  }

  const manifest = fs.readFileSync(manifestSrc, 'utf8')
    .replace(/\$\{\{BOT_ID\}\}/g, botId)
    .replace(/\$\{\{TEAMS_APP_ID\}\}/g, botId)
    .replace(/\$\{\{APP_NAME_SUFFIX\}\}/g, '');

  fs.writeFileSync(path.join(buildDir, 'manifest.json'), manifest);

  for (const icon of ['color.png', 'outline.png']) {
    const src = path.join(APP_PKG_DIR, icon);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(buildDir, icon));
    }
  }

  const zipPath = path.join(buildDir, 'appPackage.zip');
  try {
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    if (process.platform === 'win32') {
      execSync(`tar -acf "${zipPath}" -C "${buildDir}" manifest.json color.png outline.png`);
    } else {
      execSync(`cd "${buildDir}" && zip -j "${zipPath}" manifest.json color.png outline.png`);
    }
    console.log('  Teams App packaged: ' + zipPath);
  } catch {
    console.log('  WARNING: Failed to create zip. Manually zip files in ' + buildDir);
  }

  console.log('');
  console.log('Upload this zip to Teams:');
  console.log('  Teams > Apps > Manage your apps > Upload an app');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function checkPort(port) {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${port}/api/messages`, res => {
      resolve(true);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

async function startBot(config) {
  console.log('');
  console.log('=== Starting TeamBot ===');
  console.log('');

  // Check if already running
  if (fs.existsSync(PID_FILE)) {
    console.log('WARNING: TeamBot may already be running.');
    const answer = await ask('Kill existing and restart? (y/N): ');
    if (answer.toLowerCase() === 'y') {
      stopBot();
    } else {
      console.log('Exiting.');
      process.exit(0);
    }
  }

  // Find tunnel
  console.log('[1/3] Finding dev tunnel...');
  let tunnelId;
  try {
    const list = execSync('devtunnel list', { encoding: 'utf8' });
    const lines = list.split('\n').filter(l => l.match(/^\S+\.\S+/));
    if (lines.length > 0) {
      tunnelId = lines[0].split(/\s+/)[0].trim();
    }
  } catch {}

  if (!tunnelId) {
    console.log('  No dev tunnel found. Creating one...');
    try {
      execSync('devtunnel create --allow-anonymous', { stdio: 'inherit' });
      execSync(`devtunnel port create -p ${BOT_PORT}`, { stdio: 'inherit' });
      // Re-read
      const list = execSync('devtunnel list', { encoding: 'utf8' });
      const lines = list.split('\n').filter(l => l.match(/^\S+\.\S+/));
      if (lines.length > 0) {
        tunnelId = lines[0].split(/\s+/)[0].trim();
      }
    } catch (e) {
      console.log('  ERROR: Failed to create dev tunnel. Create manually:');
      console.log('    devtunnel create --allow-anonymous');
      console.log('    devtunnel port create -p 3978');
      process.exit(1);
    }
  }
  console.log(`  Tunnel: ${tunnelId}`);

  // Start tunnel
  console.log('[2/3] Starting dev tunnel...');
  const tunnelLog = fs.openSync(TUNNEL_LOG, 'w');
  const tunnelProc = spawn('devtunnel', ['host', tunnelId], {
    stdio: ['ignore', tunnelLog, tunnelLog],
    windowsHide: true,
    shell: true,
  });
  tunnelProc.unref();

  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    try {
      const log = fs.readFileSync(TUNNEL_LOG, 'utf8');
      if (log.includes('Ready to accept connections')) break;
    } catch {}
  }

  let tunnelUrl = '';
  try {
    const log = fs.readFileSync(TUNNEL_LOG, 'utf8');
    const match = log.match(/https:\/\/\S+-3978\.\S+/);
    if (match) tunnelUrl = match[0];
  } catch {}

  if (tunnelUrl) {
    console.log(`  Tunnel URL: ${tunnelUrl}`);
  } else {
    console.log('  WARNING: Could not detect tunnel URL. Check ' + TUNNEL_LOG);
  }

  // Start bot (background)
  console.log(`[3/3] Starting Bot on port ${BOT_PORT}...`);

  const env = {
    ...process.env,
    PORT: BOT_PORT,
    CLIENT_ID: config.botId,
    CLIENT_PASSWORD: config.clientSecret,
    CLIENT_SECRET: config.clientSecret,
    TENANT_ID: config.tenantId,
    TEAMBOT_DATA_DIR: TEAMBOT_DIR,
  };

  const botLog = fs.openSync(BOT_LOG, 'w');
  const botProc = spawn('node', [path.join(PKG_DIR, 'dist', 'index.js')], {
    stdio: ['ignore', botLog, botLog],
    windowsHide: true,
    env,
    shell: true,
  });
  botProc.unref();

  let botReady = false;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    try {
      const ok = await checkPort(BOT_PORT);
      if (ok) { botReady = true; break; }
    } catch {}
  }

  if (botReady) {
    console.log('  Bot ready.');
  } else {
    console.log('  WARNING: Bot may not be ready yet. Check ' + BOT_LOG);
  }

  // Save PIDs
  fs.writeFileSync(PID_FILE, `${tunnelProc.pid}\n${botProc.pid}\n`);

  console.log('');
  console.log('=== TeamBot Running ===');
  console.log('');
  console.log(`  Bot:    http://localhost:${BOT_PORT}`);
  if (tunnelUrl) console.log(`  Tunnel: ${tunnelUrl}`);
  console.log('');
  console.log('  Send messages to your Bot in Teams.');
  console.log(`  Logs: ${BOT_LOG}`);
  console.log(`  Stop: teambot stop`);
}

function stopBot() {
  // Kill by PID file
  if (fs.existsSync(PID_FILE)) {
    const pids = fs.readFileSync(PID_FILE, 'utf8').trim().split('\n');
    for (const pid of pids) {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        } else {
          process.kill(parseInt(pid));
        }
      } catch {}
    }
    fs.unlinkSync(PID_FILE);
  }

  // Also kill any process on port 3978
  try {
    if (process.platform === 'win32') {
      const output = execSync('netstat -ano | findstr :3978 | findstr LISTENING', { encoding: 'utf8' });
      const lines = output.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0') {
          try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); } catch {}
        }
      }
    } else {
      const output = execSync('lsof -ti:3978', { encoding: 'utf8' });
      for (const pid of output.trim().split('\n')) {
        try { process.kill(parseInt(pid)); } catch {}
      }
    }
  } catch {}

  // Kill devtunnel host processes
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /IM devtunnel.exe /F', { stdio: 'ignore' });
    } else {
      execSync('pkill -f "devtunnel host"', { stdio: 'ignore' });
    }
  } catch {}

  console.log('TeamBot stopped.');
}

function encodeCwd() {
  const cwd = process.cwd();
  const normalized = cwd.replace(/[\\/]/g, '/');
  let encoded = normalized;
  const unixDrive = /^\/([a-zA-Z])\//;
  const winDrive = /^([A-Z]):\//;
  if (unixDrive.test(encoded)) {
    encoded = encoded.replace(unixDrive, (_, d) => d.toUpperCase() + '--');
  } else if (winDrive.test(encoded)) {
    encoded = encoded.replace(winDrive, (_, d) => d + '--');
  }
  encoded = encoded.replace(/\//g, '-');
  return encoded;
}

function findClaudeSessionId() {
  const encoded = encodeCwd();
  const claudeProjectDir = path.join(HOME, '.claude', 'projects', encoded);
  if (!fs.existsSync(claudeProjectDir)) return null;
  try {
    const files = fs.readdirSync(claudeProjectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(claudeProjectDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length > 0) return files[0].name.replace('.jsonl', '');
  } catch {}
  return null;
}

function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const urlObj = new URL(url);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function connectTeams(sessionName) {
  const botUrl = `http://localhost:${BOT_PORT}`;
  const stateFile = path.join(HOME, '.claude', 'teams-session');

  console.log('=== TeamBot Connect ===');
  console.log('');

  // Find Claude session
  const claudeSessionId = findClaudeSessionId();

  // Default session name
  if (!sessionName) {
    sessionName = claudeSessionId ? `mirror-${claudeSessionId.substring(0, 8)}` : 'mirror';
  }

  // Check bot running
  try {
    await httpPost(`${botUrl}/api/inbox`, { session_id: 'ping' });
    console.log('Bot is running.');
  } catch {
    console.log('ERROR: Bot is not running. Start it first with: teambot');
    process.exit(1);
  }

  // Register
  console.log(`Registering terminal session [${sessionName}]...`);
  const regBody = { session_id: sessionName };
  if (claudeSessionId) regBody.claude_session_id = claudeSessionId;
  await httpPost(`${botUrl}/api/register`, regBody);

  if (claudeSessionId) {
    console.log(`  Claude session: ${claudeSessionId.substring(0, 8)}... (auto-bound)`);
  }

  // Save state for hooks
  fs.writeFileSync(stateFile, `${sessionName}\n${botUrl}\n${claudeSessionId || ''}\n`);

  console.log('');
  console.log('=== Connected! ===');
  console.log('');
  console.log(`  Terminal session: ${sessionName}`);
  console.log(`  Bot: ${botUrl}`);
  if (claudeSessionId) {
    console.log(`  Claude session: ${claudeSessionId.substring(0, 8)}...`);
  }
  console.log('');
  console.log('  Your input and Claude\'s responses will sync to Teams.');
  console.log('  Run "teambot disconnect" to stop.');
}

function disconnectTeams() {
  const stateFile = path.join(HOME, '.claude', 'teams-session');
  if (!fs.existsSync(stateFile)) {
    console.log('Not connected to Teams.');
    return;
  }
  const sessionId = fs.readFileSync(stateFile, 'utf8').split('\n')[0];
  fs.unlinkSync(stateFile);
  console.log(`Disconnected terminal session [${sessionId}].`);
  console.log('Hooks will no longer push messages to Teams.');
}

async function handoff() {
  const botUrl = `http://localhost:${BOT_PORT}`;
  const stateFile = path.join(HOME, '.claude', 'teams-handoff');

  const claudeSessionId = findClaudeSessionId();
  if (!claudeSessionId) {
    console.log('ERROR: Could not find Claude session ID.');
    console.log('Make sure you are running this from a directory with an active Claude session.');
    process.exit(1);
  }

  // Tell bot
  try {
    const result = await httpPost(`${botUrl}/api/handoff`, { claude_session_id: claudeSessionId });
    try {
      const parsed = JSON.parse(result.body);
      if (parsed.error) {
        console.log('ERROR: ' + parsed.error);
        process.exit(1);
      }
    } catch {}
  } catch {
    console.log('ERROR: Bot is not running. Start it first with: teambot');
    process.exit(1);
  }

  // Save state
  fs.writeFileSync(stateFile, `CLAUDE_SESSION_ID=${claudeSessionId}\nBOT_URL=${botUrl}\nCWD=${process.cwd()}\n`);

  // Stop mirroring
  const mirrorState = path.join(HOME, '.claude', 'teams-session');
  try { fs.unlinkSync(mirrorState); } catch {}

  console.log('');
  console.log('=== Handoff Ready ===');
  console.log('');
  console.log(`  Claude session: ${claudeSessionId.substring(0, 8)}...`);
  console.log(`  Bot: ${botUrl}`);
  console.log('');
  console.log('  Now exit Claude Code (/exit or Ctrl+C).');
  console.log('  Then continue your work from Teams.');
  console.log('');
  console.log('  When you come back, run:');
  console.log(`    claude --resume ${claudeSessionId}`);
  console.log('  Or:');
  console.log('    teambot takeback');
}

async function takeback() {
  const stateFile = path.join(HOME, '.claude', 'teams-handoff');
  if (!fs.existsSync(stateFile)) {
    console.log('No handoff session found. Nothing to take back.');
    return;
  }

  const content = fs.readFileSync(stateFile, 'utf8');
  const vars = {};
  for (const line of content.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) vars[line.substring(0, eq)] = line.substring(eq + 1);
  }

  const claudeSessionId = vars.CLAUDE_SESSION_ID;
  const botUrl = vars.BOT_URL || `http://localhost:${BOT_PORT}`;

  if (!claudeSessionId) {
    console.log('ERROR: No session ID in handoff file.');
    process.exit(1);
  }

  try {
    await httpPost(`${botUrl}/api/takeback`, { claude_session_id: claudeSessionId });
  } catch {}

  fs.unlinkSync(stateFile);

  console.log('');
  console.log('=== Session Taken Back ===');
  console.log('');
  console.log(`  Claude session: ${claudeSessionId.substring(0, 8)}...`);
  console.log('');
  console.log('  Resume your terminal session:');
  console.log(`    claude --resume ${claudeSessionId}`);
  console.log('');
  console.log('  Teams will switch to independent Claude sessions.');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'stop') {
    stopBot();
    return;
  }

  if (command === 'config') {
    await configure();
    return;
  }

  if (command === 'connect') {
    await connectTeams(args[1]);
    return;
  }

  if (command === 'disconnect') {
    disconnectTeams();
    return;
  }

  if (command === 'handoff') {
    await handoff();
    return;
  }

  if (command === 'takeback') {
    await takeback();
    return;
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log('Usage: teambot [command]');
    console.log('');
    console.log('Commands:');
    console.log('  (none)       Configure (if needed) and start the bot');
    console.log('  stop         Stop the running bot');
    console.log('  config       Re-run configuration');
    console.log('  connect      Connect terminal to Teams (mirror mode)');
    console.log('  disconnect   Stop mirroring terminal to Teams');
    console.log('  handoff      Hand off Claude session to Teams');
    console.log('  takeback     Take back Claude session from Teams');
    console.log('  help         Show this help');
    return;
  }

  // Default: configure if needed, then start
  checkPrerequisites();

  let config = loadConfig();
  if (!config) {
    config = await configure();
  } else {
    console.log('Using saved config from ' + CONFIG_FILE);
  }

  startBot(config);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
