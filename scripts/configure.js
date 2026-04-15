#!/usr/bin/env node
// configure.js — Interactive setup wizard for TeamBot
// Usage: node scripts/configure.js

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const readline = require('readline');

const PROJECT_DIR = path.resolve(__dirname, '..');
const LOCAL_CONFIGS = path.join(PROJECT_DIR, '.localConfigs');
const APP_DIR = path.join(PROJECT_DIR, 'appPackage');
const BUILD_DIR = path.join(APP_DIR, 'build');
const MANIFEST = path.join(APP_DIR, 'manifest.json');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      execSync(`start "" "${url}"`, { stdio: 'ignore', shell: true });
    } else if (process.platform === 'darwin') {
      execSync(`open "${url}"`, { stdio: 'ignore' });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    }
  } catch {
    // Ignore errors — user can open manually
  }
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

    proc.stdout.on('data', (data) => {
      output += data.toString();
      const match = output.match(/https:\/\/\S+-3978\.\S+/);
      if (match && !resolved) {
        resolved = true;
        proc.kill();
        resolve(match[0]);
      }
    });

    proc.stderr.on('data', (data) => {
      output += data.toString();
      const match = output.match(/https:\/\/\S+-3978\.\S+/);
      if (match && !resolved) {
        resolved = true;
        proc.kill();
        resolve(match[0]);
      }
    });

    // Timeout after 15 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        resolve(null);
      }
    }, 15000);

    proc.on('error', () => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });
  });
}

async function configure() {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║     TeamBot — 一键配置向导           ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
  console.log('本向导将引导你完成以下步骤：');
  console.log('  1. 配置 Dev Tunnel（公网隧道）');
  console.log('  2. 注册 Teams Bot');
  console.log('  3. 填写凭证信息');
  console.log('  4. 生成配置文件和 Teams App 安装包');
  console.log('');

  // ════════════════════════════════════════
  // Step 1: Dev Tunnel
  // ════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  步骤 1/4：配置 Dev Tunnel');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Check devtunnel CLI
  try {
    execSync('devtunnel --version', { stdio: 'ignore' });
  } catch {
    console.log('  Dev Tunnel CLI 未安装。请先安装：');
    console.log('    winget install Microsoft.devtunnel');
    console.log('');
    console.log('  安装后重新运行此脚本。');
    process.exit(1);
  }

  // Check for existing tunnel
  let tunnelId = findTunnelId();
  let tunnelUrl = '';

  if (tunnelId) {
    console.log(`  已找到 Dev Tunnel: ${tunnelId}`);
    const useit = await ask('  使用这个 tunnel？(Y/n) ');
    if (useit.toLowerCase() === 'n') {
      tunnelId = null;
    }
  }

  if (!tunnelId) {
    console.log('');
    console.log('  需要创建一个新的 Dev Tunnel。');
    console.log('  如果你还没有登录，请先运行：devtunnel user login');
    console.log('');
    await ask('  准备好后按回车继续...');
    console.log('');
    console.log('  正在创建 tunnel...');
    try {
      const result = execSync('devtunnel create --allow-anonymous', { encoding: 'utf8' });
      // Parse tunnel ID from output
      const match = result.match(/(\S+\.\S+)/);
      if (match) tunnelId = match[1];
    } catch (e) {
      console.log('  创建 tunnel 失败。请手动运行：');
      console.log('    devtunnel create --allow-anonymous');
      console.log('    devtunnel port create -p 3978');
      console.log('');
      tunnelUrl = await ask('  输入你的 tunnel URL（如 https://xxxxx-3978.asse.devtunnels.ms）：');
    }

    if (tunnelId && !tunnelUrl) {
      console.log(`  Tunnel 创建成功: ${tunnelId}`);
      console.log('  正在添加端口 3978...');
      try {
        execSync(`devtunnel port create ${tunnelId} -p 3978`, { stdio: 'ignore' });
        console.log('  端口添加成功。');
      } catch {
        // Port may already exist
        console.log('  端口已存在或添加完成。');
      }
    }
  }

  // Get tunnel URL
  if (tunnelId && !tunnelUrl) {
    console.log('');
    console.log('  正在获取 tunnel URL（启动 tunnel 几秒钟）...');
    tunnelUrl = await getTunnelUrl(tunnelId);
    if (!tunnelUrl) {
      console.log('  无法自动获取 URL。');
      tunnelUrl = await ask('  请手动输入 tunnel URL（如 https://xxxxx-3978.asse.devtunnels.ms）：');
    }
  }

  if (tunnelUrl) {
    // Remove trailing slash
    tunnelUrl = tunnelUrl.replace(/\/+$/, '');
    console.log(`  Tunnel URL: ${tunnelUrl}`);
  }

  const messagingEndpoint = tunnelUrl ? `${tunnelUrl}/api/messages` : '<your-tunnel-url>/api/messages';
  console.log(`  Messaging Endpoint: ${messagingEndpoint}`);
  console.log('');

  // ════════════════════════════════════════
  // Step 2: Bot Registration + Credentials (one at a time)
  // ════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  步骤 2/4：注册 Teams Bot');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  现在需要在 Teams Developer Portal 中注册 Bot。');
  console.log('  正在打开 Teams Developer Portal...');
  openBrowser('https://dev.teams.microsoft.com/tools/bots');
  console.log('');
  console.log('  请在页面中点击 "New Bot" → 输入名称 → 创建');
  console.log('  创建后页面上会显示 Bot ID。');
  console.log('');

  const botId = await ask('  粘贴 Bot ID (CLIENT_ID): ');
  if (!botId) {
    console.log('  ERROR: Bot ID 是必填项。');
    process.exit(1);
  }

  console.log('');
  console.log('  接下来在同一页面找到 "Client secrets"');
  console.log('  → 点击 "Add a client secret" → 记下生成的 secret（只显示一次！）');
  console.log('');

  const clientSecret = await ask('  粘贴 Client Secret (CLIENT_SECRET): ');
  if (!clientSecret) {
    console.log('  ERROR: Client Secret 是必填项。');
    process.exit(1);
  }

  console.log('');
  console.log('  接下来在同一页面 Configure → Endpoint address 填写：');
  console.log(`  ${messagingEndpoint}`);
  console.log('');
  await ask('  填好 Endpoint 后按回车继续...');

  // ════════════════════════════════════════
  // Step 3: Tenant ID
  // ════════════════════════════════════════
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  步骤 3/4：获取 Tenant ID');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  Tenant ID 需要在 Bot Framework Portal 中查看。');
  console.log('  正在打开 Bot Framework Portal...');
  openBrowser('https://dev.botframework.com/bots');
  console.log('');
  console.log('  找到你的 Bot → Settings → 页面上的 "App Tenant ID"');
  console.log('');

  const tenantId = await ask('  粘贴 Tenant ID (TENANT_ID): ');
  if (!tenantId) {
    console.log('  ERROR: Tenant ID 是必填项（缺少会导致 401 错误）。');
    process.exit(1);
  }

  // ════════════════════════════════════════
  // Step 4: Generate files
  // ════════════════════════════════════════
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  步骤 4/4：生成配置文件');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const appName = await ask('  给你的 Teams App 起个名字（直接回车默认 teambot）：') || 'teambot';
  console.log('');

  // Create .localConfigs
  console.log('  [1/2] 生成 .localConfigs...');
  const config = [
    `PORT=3978`,
    `CLIENT_ID=${botId}`,
    `CLIENT_SECRET=${clientSecret}`,
    `TENANT_ID=${tenantId}`,
  ].join('\n') + '\n';
  fs.writeFileSync(LOCAL_CONFIGS, config);
  console.log('  完成。');

  // Package Teams App
  console.log('  [2/2] 打包 Teams App...');

  if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
  }

  const manifest = fs.readFileSync(MANIFEST, 'utf8')
    .replace(/\$\{\{BOT_ID\}\}/g, botId)
    .replace(/\$\{\{TEAMS_APP_ID\}\}/g, botId)
    .replace(/\$\{\{APP_NAME_SUFFIX\}\}/g, '')
    .replace(/"short":\s*"[^"]*"/, `"short": "${appName}"`);

  fs.writeFileSync(path.join(BUILD_DIR, 'manifest.json'), manifest);

  for (const icon of ['color.png', 'outline.png']) {
    fs.copyFileSync(path.join(APP_DIR, icon), path.join(BUILD_DIR, icon));
  }

  const zipPath = path.join(BUILD_DIR, 'appPackage.zip');
  try {
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    if (process.platform === 'win32') {
      execSync(`tar -acf "${zipPath}" -C "${BUILD_DIR}" manifest.json color.png outline.png`);
    } else {
      execSync(`cd "${BUILD_DIR}" && zip -j "${zipPath}" manifest.json color.png outline.png`);
    }
    console.log('  完成。');
  } catch {
    console.log('  WARNING: 自动打包失败。请手动打包 appPackage/build/ 下的文件。');
  }

  // ════════════════════════════════════════
  // Done
  // ════════════════════════════════════════
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║          配置完成！                  ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
  console.log('  生成的文件：');
  console.log(`    .localConfigs       — Bot 凭证配置`);
  console.log(`    appPackage/build/   — Teams App 安装包`);
  console.log('');
  console.log('  接下来：');
  console.log('');
  console.log('  1. 上传 Teams App：');
  console.log(`     文件位置：${zipPath}`);
  console.log('     打开 Teams → 应用 → 管理你的应用 → 上传自定义应用');
  console.log('');
  console.log('  2. 启动 Bot：');
  console.log('     npm run start:teams');
  console.log('');
  console.log('  3. 在 Teams 中找到你的 Bot，发一条消息测试。');
  console.log('');
}

configure().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
