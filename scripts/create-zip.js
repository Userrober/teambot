const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const buildDir = path.resolve('appPackage/build');
const outZip = path.join(buildDir, 'appPackage.teams.zip');

try { fs.unlinkSync(outZip); } catch {}

const ps = `
Add-Type -AssemblyName System.IO.Compression.FileSystem;
$z = [System.IO.Compression.ZipFile]::Open('${outZip.replace(/\\/g, '\\\\')}', 'Create');
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, '${path.join(buildDir, 'manifest.json').replace(/\\/g, '\\\\')}', 'manifest.json');
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, '${path.join(buildDir, 'color.png').replace(/\\/g, '\\\\')}', 'color.png');
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, '${path.join(buildDir, 'outline.png').replace(/\\/g, '\\\\')}', 'outline.png');
$z.Dispose();
`.trim().replace(/\n/g, ' ');

execSync(`powershell.exe -Command "${ps}"`);
console.log('Created:', fs.statSync(outZip).size, 'bytes');
