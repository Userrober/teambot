#!/usr/bin/env node
// package-app.js — Package Teams App zip with Bot ID replaced
// Usage: node scripts/package-app.js <BOT_ID>

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_DIR = path.resolve(__dirname, '..');
const APP_DIR = path.join(PROJECT_DIR, 'appPackage');
const BUILD_DIR = path.join(APP_DIR, 'build');
const MANIFEST = path.join(APP_DIR, 'manifest.json');

const botId = process.argv[2];

if (!botId) {
  console.log('Usage: node scripts/package-app.js <BOT_ID>');
  console.log('  BOT_ID: Your Bot ID from Teams Developer Portal');
  process.exit(1);
}

// Create build dir
if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}

// Replace placeholders in manifest
const manifest = fs.readFileSync(MANIFEST, 'utf8')
  .replace(/\$\{\{BOT_ID\}\}/g, botId)
  .replace(/\$\{\{TEAMS_APP_ID\}\}/g, botId)
  .replace(/\$\{\{APP_NAME_SUFFIX\}\}/g, '');

fs.writeFileSync(path.join(BUILD_DIR, 'manifest.json'), manifest);

// Copy icons
for (const icon of ['color.png', 'outline.png']) {
  fs.copyFileSync(path.join(APP_DIR, icon), path.join(BUILD_DIR, icon));
}

// Create zip
const zipPath = path.join(BUILD_DIR, 'appPackage.zip');
try {
  if (process.platform === 'win32') {
    execSync(`tar -acf "${zipPath}" -C "${BUILD_DIR}" manifest.json color.png outline.png`);
  } else {
    execSync(`cd "${BUILD_DIR}" && zip -j "${zipPath}" manifest.json color.png outline.png`);
  }
  console.log(`Teams App packaged: ${zipPath}`);
  console.log('');
  console.log('Next: Upload this zip to Teams');
  console.log('  Teams > Apps > Manage your apps > Upload an app');
} catch (e) {
  console.log('ERROR: Failed to create zip.');
  console.log('Manually zip these files in appPackage/build/:');
  console.log('  manifest.json, color.png, outline.png');
}
