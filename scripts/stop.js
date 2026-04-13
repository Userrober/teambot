#!/usr/bin/env node
// stop.js — Stop TeamBot processes (Bot + dev tunnel)

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_DIR = path.resolve(__dirname, '..');
const PID_FILE = path.join(PROJECT_DIR, '.teambot.pids');

console.log('=== TeamBot Stop ===');
console.log('');

let stopped = 0;

// Kill saved PIDs
if (fs.existsSync(PID_FILE)) {
  const pids = fs.readFileSync(PID_FILE, 'utf8').trim().split('\n');
  for (const pid of pids) {
    if (!pid.trim()) continue;
    try {
      process.kill(Number(pid.trim()));
      console.log(`  Stopped process ${pid.trim()}`);
      stopped++;
    } catch {}
  }
  fs.unlinkSync(PID_FILE);
}

// Kill devtunnel processes
try {
  if (process.platform === 'win32') {
    execSync('taskkill /F /IM devtunnel.exe', { stdio: 'ignore' });
  } else {
    execSync('pkill -f "devtunnel host"', { stdio: 'ignore' });
  }
  console.log('  Stopped devtunnel');
  stopped++;
} catch {}

// Kill node processes on Bot port (3978)
const BOT_PORT = process.env.PORT || '3978';
try {
  if (process.platform === 'win32') {
    const result = execSync(`netstat -ano | findstr :${BOT_PORT} | findstr LISTENING`, { encoding: 'utf8' });
    const pids = [...new Set(result.trim().split('\n').map(line => line.trim().split(/\s+/).pop()).filter(p => p && p !== '0'))];
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        console.log(`  Stopped process ${pid} (port ${BOT_PORT})`);
        stopped++;
      } catch {}
    }
  } else {
    execSync(`lsof -ti :${BOT_PORT} | xargs kill`, { stdio: 'ignore' });
    stopped++;
  }
} catch {}

// Clean up log files
for (const f of ['.bot.log', '.tunnel.log']) {
  try { fs.unlinkSync(path.join(PROJECT_DIR, f)); } catch {}
}

if (stopped === 0) {
  console.log('  No running TeamBot processes found.');
} else {
  console.log('');
  console.log(`  Stopped ${stopped} process(es).`);
}

console.log('');
console.log('=== TeamBot Stopped ===');
