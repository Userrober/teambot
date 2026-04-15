#!/usr/bin/env node
// provision.js — One-command setup using M365 Agents Toolkit CLI
// Usage: node scripts/provision.js

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PROJECT_DIR = path.resolve(__dirname, '..');
const ENV_DIR = path.join(PROJECT_DIR, 'env');
const ENV_LOCAL = path.join(ENV_DIR, '.env.local');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, {
    cwd: PROJECT_DIR,
    stdio: 'inherit',
    shell: true,
    ...opts,
  });
}

function runQuiet(cmd) {
  return execSync(cmd, {
    cwd: PROJECT_DIR,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
  });
}

function findTunnelId() {
  try {
    const list = execSync('devtunnel list', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = list.split('\n').filter(l => l.match(/^\S+\.\S+/));
    if (lines.length > 0) {
      return lines[0].split(/\s+/)[0].trim();
    }
  } catch {}
  return null;
}

function getTunnelUrl(tunnelId) {
  return new Promise((resolve) => {
    const proc = spawn('devtunnel', ['host', tunnelId], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let output = '';
    let resolved = false;

    const onData = (data) => {
      output += data.toString();
      const match = output.match(/https:\/\/\S+-3978\.\S+/);
      if (match && !resolved) {
        resolved = true;
        proc.kill();
        resolve(match[0].replace(/\/+$/, ''));
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        resolve(null);
      }
    }, 15000);

    proc.on('error', () => {
      if (!resolved) { resolved = true; resolve(null); }
    });
  });
}

function setEnvVar(filePath, key, value) {
  if (!fs.existsSync(path.dirname(filePath))) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8');
  }
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }
  fs.writeFileSync(filePath, content);
}

async function provision() {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   TeamBot — 一键配置 (Quick Setup)   ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  // ── Step 1: Check atk CLI ──
  console.log('[1/6] 检查 M365 Agents Toolkit CLI...');
  let hasAtk = false;
  try {
    const ver = runQuiet('npx @microsoft/m365agentstoolkit-cli --version');
    console.log(`  已安装: ${ver.trim()}`);
    hasAtk = true;
  } catch {}

  if (!hasAtk) {
    console.log('  M365 Agents Toolkit CLI 未安装。');
    const install = await ask('  是否自动安装？(Y/n) ');
    if (install.toLowerCase() === 'n') {
      console.log('  请手动安装: npm install -g @microsoft/m365agentstoolkit-cli');
      console.log('  或使用手动配置: node scripts/configure.js');
      process.exit(1);
    }
    console.log('  正在安装...');
    run('npm install -g @microsoft/m365agentstoolkit-cli');
  }

  // ── Step 2: Dev Tunnel ──
  console.log('');
  console.log('[2/6] 配置 Dev Tunnel...');

  try {
    execSync('devtunnel --version', { stdio: 'ignore' });
  } catch {
    console.log('  Dev Tunnel CLI 未安装。请先安装：');
    console.log('    winget install Microsoft.devtunnel');
    console.log('  安装后重新运行此脚本。');
    process.exit(1);
  }

  let tunnelId = findTunnelId();
  let tunnelUrl = '';

  if (tunnelId) {
    console.log(`  已找到 Dev Tunnel: ${tunnelId}`);
  } else {
    console.log('  未找到 Dev Tunnel，正在创建...');
    try {
      const result = execSync('devtunnel create --allow-anonymous', { encoding: 'utf8' });
      const match = result.match(/(\S+\.\S+)/);
      if (match) tunnelId = match[1];
    } catch {}

    if (tunnelId) {
      console.log(`  Tunnel 创建成功: ${tunnelId}`);
      try {
        execSync(`devtunnel port create ${tunnelId} -p 3978`, { stdio: 'ignore' });
      } catch {}
    } else {
      console.log('  创建 tunnel 失败。请手动创建：');
      console.log('    devtunnel create --allow-anonymous');
      console.log('    devtunnel port create -p 3978');
      tunnelUrl = await ask('  输入 tunnel URL（如 https://xxxxx-3978.asse.devtunnels.ms）：');
    }
  }

  if (tunnelId && !tunnelUrl) {
    console.log('  正在获取 tunnel URL...');
    tunnelUrl = await getTunnelUrl(tunnelId);
    if (!tunnelUrl) {
      tunnelUrl = await ask('  无法自动获取 URL，请手动输入：');
    }
  }

  if (!tunnelUrl) {
    console.log('  ERROR: 无法获取 Tunnel URL。');
    process.exit(1);
  }

  tunnelUrl = tunnelUrl.replace(/\/+$/, '');
  console.log(`  Tunnel URL: ${tunnelUrl}`);

  // Write BOT_ENDPOINT to env/.env.local
  setEnvVar(ENV_LOCAL, 'BOT_ENDPOINT', tunnelUrl);
  console.log('  已写入 BOT_ENDPOINT 到 env/.env.local');

  // ── Step 3: Login ──
  console.log('');
  console.log('[3/6] 检查 Microsoft 365 登录状态...');
  let loggedIn = false;
  try {
    const authList = runQuiet('npx @microsoft/m365agentstoolkit-cli auth list');
    if (authList.includes('Logged in')) {
      console.log('  已登录。');
      loggedIn = true;
    }
  } catch {}

  if (!loggedIn) {
    console.log('  需要登录 Microsoft 365 账号（会打开浏览器）。');
    await ask('  按回车开始登录...');
    run('npx @microsoft/m365agentstoolkit-cli auth login m365');
  }

  // ── Step 4: Provision ──
  console.log('');
  console.log('[4/6] 注册 Bot 并生成凭证...');
  console.log('  这一步会自动：');
  console.log('  - 创建 Teams App');
  console.log('  - 创建 Bot（生成 CLIENT_ID + CLIENT_SECRET）');
  console.log('  - 注册到 Bot Framework');
  console.log('  - 打包 Teams App');
  console.log('');
  run('npx @microsoft/m365agentstoolkit-cli provision --env local');

  // ── Step 5: Deploy (generate .localConfigs) ──
  console.log('');
  console.log('[5/6] 生成配置文件...');
  run('npx @microsoft/m365agentstoolkit-cli deploy --env local');

  // Check .localConfigs was created
  const configPath = path.join(PROJECT_DIR, '.localConfigs');
  if (fs.existsSync(configPath)) {
    console.log('  .localConfigs 已生成。');
    const content = fs.readFileSync(configPath, 'utf8');
    const hasClientId = content.includes('CLIENT_ID=') && !content.includes('CLIENT_ID=$');
    const hasTenantId = content.includes('TENANT_ID=') && !content.includes('TENANT_ID=$');
    if (hasClientId && hasTenantId) {
      console.log('  凭证配置完成。');
    } else {
      console.log('  WARNING: 配置文件可能不完整，请检查 .localConfigs');
    }
  } else {
    console.log('  WARNING: .localConfigs 未生成。请检查上面的输出。');
  }

  // ── Step 6: Sideload ──
  console.log('');
  console.log('[6/6] 上传 Teams App...');

  // Find the packaged zip
  const buildDir = path.join(PROJECT_DIR, 'appPackage', 'build');
  let zipFile = '';
  if (fs.existsSync(buildDir)) {
    const zips = fs.readdirSync(buildDir).filter(f => f.endsWith('.zip'));
    if (zips.length > 0) {
      const localZip = zips.find(f => f.includes('local'));
      zipFile = path.join(buildDir, localZip || zips[0]);
    }
  }

  if (zipFile) {
    const sideload = await ask('  是否自动上传到 Teams？(Y/n) ');
    if (sideload.toLowerCase() !== 'n') {
      try {
        run(`npx @microsoft/m365agentstoolkit-cli install --file-path "${zipFile}"`);
        console.log('  App 已上传到 Teams。');
      } catch {
        console.log('  自动上传失败。请手动上传:');
        console.log(`  文件: ${zipFile}`);
        console.log('  打开 Teams → 应用 → 管理你的应用 → 上传自定义应用');
      }
    } else {
      console.log('  跳过上传。请手动上传:');
      console.log(`  文件: ${zipFile}`);
      console.log('  打开 Teams → 应用 → 管理你的应用 → 上传自定义应用');
    }
  } else {
    console.log('  WARNING: 未找到 App 安装包。请运行 node scripts/configure.js 手动打包。');
  }

  // ── Done ──
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║          配置完成！                  ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
  console.log('  接下来启动 Bot：');
  console.log('    npm run start:teams');
  console.log('');
  console.log('  在 Teams 中找到你的 Bot，发一条消息测试。');
  console.log('');
}

provision().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('');
  console.error('Error:', err.message);
  console.error('');
  console.error('如果一键配置失败，可以使用手动配置：');
  console.error('  node scripts/configure.js');
  process.exit(1);
});
