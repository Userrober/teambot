import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const HOOKS_DIR = path.join(os.homedir(), ".claude", "hooks");
const SETTINGS_FILE = path.join(os.homedir(), ".claude", "settings.json");
const PROMPT_HOOK = path.join(HOOKS_DIR, "push-prompt-to-teams.sh");
const STOP_HOOK = path.join(HOOKS_DIR, "push-to-teams.sh");

const PROMPT_HOOK_CONTENT = `#!/bin/bash
# UserPromptSubmit hook: mirror user prompt to Teams (filtered by cwd whitelist).
# Auto-installed by claude-teams-client.

INPUT=$(cat)

DATA=$(node -e "
  try {
    const i = JSON.parse(require('fs').readFileSync(0,'utf8'));
    process.stdout.write(JSON.stringify({
      text: String(i.prompt || ''),
      cwd: String(i.cwd || ''),
      sessionId: String(i.session_id || '')
    }));
  } catch { process.exit(0); }
" <<< "$INPUT" 2>/dev/null)

[ -z "$DATA" ] && exit 0

USER_MSG=$(echo "$DATA" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).text)")
CWD=$(echo "$DATA" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).cwd)")
SID=$(echo "$DATA" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).sessionId)")

[ -z "$USER_MSG" ] || [ "$USER_MSG" = "null" ] && exit 0

claude-teams-client mirror --text "[user] $USER_MSG" --cwd "$CWD" --session "$SID" >/dev/null 2>&1 &
disown 2>/dev/null
exit 0
`;

const STOP_HOOK_CONTENT = `#!/bin/bash
# Stop hook: mirror assistant's last response to Teams (filtered by cwd whitelist).
# Auto-installed by claude-teams-client.

INPUT=$(cat)

DATA=$(node -e "
  try {
    const i = JSON.parse(require('fs').readFileSync(0,'utf8'));
    let text = i.last_assistant_message || i.response || i.message || '';
    if (!text && i.transcript_path) {
      const fs = require('fs');
      try {
        const lines = fs.readFileSync(i.transcript_path,'utf8').trim().split('\\n');
        for (let j = lines.length - 1; j >= 0; j--) {
          const obj = JSON.parse(lines[j]);
          if (obj.type === 'assistant' && obj.message) {
            const c = obj.message.content;
            if (typeof c === 'string') { text = c; break; }
            if (Array.isArray(c)) {
              text = c.filter(b => b.type === 'text').map(b => b.text).join('\\n');
              if (text) break;
            }
          }
        }
      } catch {}
    }
    process.stdout.write(JSON.stringify({
      text: String(text || ''),
      cwd: String(i.cwd || ''),
      sessionId: String(i.session_id || '')
    }));
  } catch { process.exit(0); }
" <<< "$INPUT" 2>/dev/null)

[ -z "$DATA" ] && exit 0

RESPONSE=$(echo "$DATA" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).text)")
CWD=$(echo "$DATA" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).cwd)")
SID=$(echo "$DATA" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).sessionId)")

[ -z "$RESPONSE" ] || [ "$RESPONSE" = "null" ] && exit 0

claude-teams-client mirror --text "[claude] $RESPONSE" --cwd "$CWD" --session "$SID" >/dev/null 2>&1 &
disown 2>/dev/null
exit 0
`;

interface HookEntry {
  matcher?: string;
  hooks: Array<{ type: string; command: string; timeout?: number }>;
}

interface ClaudeSettings {
  hooks?: {
    UserPromptSubmit?: HookEntry[];
    Stop?: HookEntry[];
    [key: string]: HookEntry[] | undefined;
  };
  [key: string]: unknown;
}

function ensureHookEntry(list: HookEntry[] | undefined, command: string): { list: HookEntry[]; changed: boolean } {
  const arr = list ? [...list] : [];
  for (const entry of arr) {
    for (const h of entry.hooks || []) {
      if (h.command === command) return { list: arr, changed: false };
    }
  }
  arr.push({ matcher: "", hooks: [{ type: "command", command, timeout: 10 }] });
  return { list: arr, changed: true };
}

export interface InstallResult {
  hooksWritten: boolean;
  settingsUpdated: boolean;
  settingsPath: string;
}

export function installHooks(): InstallResult {
  const result: InstallResult = {
    hooksWritten: false,
    settingsUpdated: false,
    settingsPath: SETTINGS_FILE,
  };

  if (!fs.existsSync(HOOKS_DIR)) fs.mkdirSync(HOOKS_DIR, { recursive: true });

  const wrote = (target: string, content: string): boolean => {
    if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === content) return false;
    fs.writeFileSync(target, content);
    try { fs.chmodSync(target, 0o755); } catch {}
    return true;
  };

  if (wrote(PROMPT_HOOK, PROMPT_HOOK_CONTENT)) result.hooksWritten = true;
  if (wrote(STOP_HOOK, STOP_HOOK_CONTENT)) result.hooksWritten = true;

  let settings: ClaudeSettings = {};
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    } catch {
      console.warn(`[install-hooks] could not parse ${SETTINGS_FILE}, leaving it alone`);
      return result;
    }
  } else {
    if (!fs.existsSync(path.dirname(SETTINGS_FILE))) {
      fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    }
  }

  if (!settings.hooks) settings.hooks = {};
  const promptCmd = `bash ${PROMPT_HOOK.replace(/\\/g, "/")}`;
  const stopCmd = `bash ${STOP_HOOK.replace(/\\/g, "/")}`;

  const promptResult = ensureHookEntry(settings.hooks.UserPromptSubmit, promptCmd);
  const stopResult = ensureHookEntry(settings.hooks.Stop, stopCmd);

  if (promptResult.changed) {
    settings.hooks.UserPromptSubmit = promptResult.list;
    result.settingsUpdated = true;
  }
  if (stopResult.changed) {
    settings.hooks.Stop = stopResult.list;
    result.settingsUpdated = true;
  }

  if (result.settingsUpdated) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  }

  return result;
}
