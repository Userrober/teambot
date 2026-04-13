#!/usr/bin/env node
// start.js — Start TeamBot (dev tunnel + Bot server)

const { exec, execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const PROJECT_DIR = path.resolve(__dirname, '..');
const BOT_PORT = process.env.PORT || '3978';
const PID_FILE = path.join(PROJECT_DIR, '.teambot.pids');
const TUNNEL_LOG = path.join(PROJECT_DIR, '.tunnel.log');
const BOT_LOG = path.join(PROJECT_DIR, '.bot.log');

console.log('=== TeamBot Start ===');
console.log('');

// Check .localConfigs
if (!fs.existsSync(path.join(PROJECT_DIR, '.localConfigs'))) {
  console.log('ERROR: .localConfigs not found.');
  console.log('You need to complete one-time Teams setup first. See README.md.');
  process.exit(1);
}

// Check devtunnel
try {
  execSync('devtunnel --version', { stdio: 'ignore' });
} catch {
  console.log('ERROR: Dev Tunnel CLI not found.');
  console.log('Install it: winget install Microsoft.devtunnel');
  process.exit(1);
}

// Check if already running
if (fs.existsSync(PID_FILE)) {
  console.log('WARNING: TeamBot may already be running. Run "npm run stop" first.');
  console.log('');
}

async function start() {
  // Find tunnel ID
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
    console.log('  ERROR: No dev tunnel found.');
    console.log('  Create one first:');
    console.log('    devtunnel create --allow-anonymous');
    console.log('    devtunnel port create -p 3978');
    process.exit(1);
  }
  console.log(`  Tunnel: ${tunnelId}`);

  // Start dev tunnel
  console.log('[2/3] Starting dev tunnel...');
  const tunnelLog = fs.openSync(TUNNEL_LOG, 'w');
  const tunnelProc = spawn('devtunnel', ['host', tunnelId], {
    stdio: ['ignore', tunnelLog, tunnelLog],
    windowsHide: true,
    shell: true,
  });
  tunnelProc.unref();
  console.log(`  Tunnel PID: ${tunnelProc.pid}`);

  // Wait for tunnel
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
    console.log('  WARNING: Could not detect tunnel URL. Check .tunnel.log');
  }

  // Start Bot
  console.log(`[3/3] Starting Bot on port ${BOT_PORT}...`);

  // Read .localConfigs
  const localConfigs = fs.readFileSync(path.join(PROJECT_DIR, '.localConfigs'), 'utf8');
  const env = { ...process.env, PORT: BOT_PORT };
  for (const line of localConfigs.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
  }

  const botLog = fs.openSync(BOT_LOG, 'w');
  const botProc = spawn('npx', ['ts-node', './index.ts'], {
    stdio: ['ignore', botLog, botLog],
    windowsHide: true,
    cwd: PROJECT_DIR,
    env,
    shell: true,
  });
  botProc.unref();
  console.log(`  Bot PID: ${botProc.pid}`);

  // Wait for Bot
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
    console.log('  WARNING: Bot may not be ready yet. Check .bot.log');
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
  console.log('  Logs: .bot.log / .tunnel.log');
  console.log('  Stop: npm run stop');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/messages`, (res) => {
      resolve(true);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

start().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
