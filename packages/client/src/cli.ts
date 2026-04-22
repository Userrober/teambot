#!/usr/bin/env node
import * as http from "http";
import {
  loadOrCreateConfig,
  updateConfig,
  resetToken,
  configPath,
  addMirrorCwd,
  removeMirrorCwd,
  listMirrorCwds,
  mirrorCwdsPath,
} from "./config";
import { runDaemon } from "./daemon";

const DEFAULT_BOT_URL = "wss://teambot-mih3.onrender.com/ws";
const DEFAULT_MIRROR_PORT = 47291;

function printBanner(token: string, botUrl: string): void {
  const line = "─".repeat(63);
  console.log(`┌${line}`);
  console.log("│  Claude Teams Client");
  console.log(`│  Token:    ${token}`);
  console.log(`│  Bot URL:  ${botUrl}`);
  console.log(`│  Config:   ${configPath()}`);
  console.log("│");
  console.log("│  In Teams, send this command once to bind your account:");
  console.log(`│    /pair ${token}`);
  console.log("│");
  console.log("│  After pairing, just keep this client running.");
  console.log(`└${line}`);
}

function printHelp(): void {
  console.log(`claude-teams-client — bridge Teams ↔ your local Claude Code CLI

Usage:
  claude-teams-client [start]              Start the client (default)
  claude-teams-client status               Print current config
  claude-teams-client config --bot-url URL Set the bot WebSocket URL
  claude-teams-client reset-token          Generate a new token (requires re-pairing)
  claude-teams-client mirror --text MSG    Push text to Teams (used by Claude hooks)
  claude-teams-client mirror-on            Enable mirroring for current directory
  claude-teams-client mirror-off           Disable mirroring for current directory
  claude-teams-client mirror-list          List directories with mirroring enabled
  claude-teams-client help                 Show this help

Environment:
  BOT_WS_URL              Override bot URL (also configurable via --bot-url)
  CLAUDE_CLI_PATH         Path to the claude binary (default: "claude" or "claude.cmd")
  CLAUDE_MODEL            Default model id
  CLAUDE_WORKING_DIR      Working directory for Claude (default: cwd)
  CLAUDE_TIMEOUT_MS       Per-message timeout (default 300000)
  CLAUDE_PERMISSION_MODE  auto | acceptEdits | bypassPermissions (default auto)

Config file: ${configPath()}`);
}

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  const prefix = `${name}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit?.slice(prefix.length);
}

function cmdStatus(): void {
  const cfg = loadOrCreateConfig();
  const botUrl = process.env.BOT_WS_URL || cfg.botUrl || DEFAULT_BOT_URL;
  console.log(`Token:    ${cfg.token}`);
  console.log(`Bot URL:  ${botUrl}`);
  console.log(`Created:  ${cfg.createdAt}`);
  console.log(`Config:   ${configPath()}`);
}

function cmdConfig(argv: string[]): void {
  const botUrl = parseArg(argv, "--bot-url");
  if (!botUrl) {
    console.error("Usage: claude-teams-client config --bot-url <url>");
    process.exit(1);
  }
  const cfg = updateConfig({ botUrl });
  console.log(`✓ Saved bot URL: ${cfg.botUrl}`);
}

function cmdResetToken(): void {
  const cfg = resetToken();
  console.log(`✓ New token generated: ${cfg.token}`);
  console.log(`Re-pair in Teams: /pair ${cfg.token}`);
}

function cmdMirror(argv: string[]): void {
  const textArg = parseArg(argv, "--text");
  const cwdArg = parseArg(argv, "--cwd") || process.env.PWD || process.cwd();
  const sessionArg = parseArg(argv, "--session");
  const readStdin = (): Promise<string> => new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) { resolve(""); return; }
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", () => resolve(data));
  });

  (async () => {
    const text = textArg ?? (await readStdin());
    if (!text || text.trim().length === 0) {
      console.error("Usage: claude-teams-client mirror --text <msg> [--cwd <dir>] [--session <id>]");
      process.exit(1);
    }
    const port = parseInt(process.env.MIRROR_PORT || String(DEFAULT_MIRROR_PORT));
    const body = JSON.stringify({ text, cwd: cwdArg, sessionId: sessionArg });
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/mirror",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      if (res.statusCode === 200) {
        process.exit(0);
      } else {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          console.error(`mirror failed: ${res.statusCode} ${data}`);
          process.exit(1);
        });
      }
    });
    req.on("error", (err) => {
      console.error(`mirror failed: ${err.message} (is claude-teams-client running?)`);
      process.exit(1);
    });
    req.write(body);
    req.end();
  })();
}

function cmdMirrorOn(): void {
  const cwd = process.cwd();
  const { added, cwd: norm } = addMirrorCwd(cwd);
  if (added) {
    console.log(`✓ Mirror enabled for: ${norm}`);
  } else {
    console.log(`Mirror already enabled for: ${norm}`);
  }
  console.log(`  (Subdirectories included. Stored in ${mirrorCwdsPath()})`);
}

function cmdMirrorOff(): void {
  const cwd = process.cwd();
  const { removed, cwd: norm } = removeMirrorCwd(cwd);
  if (removed) {
    console.log(`✓ Mirror disabled for: ${norm}`);
  } else {
    console.log(`Mirror was not enabled for: ${norm}`);
  }
}

function cmdMirrorList(): void {
  const list = listMirrorCwds();
  if (list.length === 0) {
    console.log("No mirror directories configured.");
    console.log("Run `claude-teams-client mirror-on` in a directory to enable mirroring there.");
    return;
  }
  console.log("Mirror enabled for:");
  for (const cwd of list) console.log(`  ${cwd}`);
}

function cmdStart(): void {
  const cfg = loadOrCreateConfig();
  const token = process.env.CLIENT_TOKEN || cfg.token;
  const botUrl = process.env.BOT_WS_URL || cfg.botUrl || DEFAULT_BOT_URL;
  printBanner(token, botUrl);
  runDaemon({ botUrl, token });
}

function main(): void {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  switch (cmd) {
    case undefined:
    case "start":
      cmdStart();
      break;
    case "status":
      cmdStatus();
      break;
    case "config":
      cmdConfig(argv);
      break;
    case "reset-token":
      cmdResetToken();
      break;
    case "mirror":
      cmdMirror(argv);
      break;
    case "mirror-on":
      cmdMirrorOn();
      break;
    case "mirror-off":
      cmdMirrorOff();
      break;
    case "mirror-list":
      cmdMirrorList();
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      printHelp();
      process.exit(1);
  }
}

main();
