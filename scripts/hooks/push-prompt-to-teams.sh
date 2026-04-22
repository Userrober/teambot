#!/bin/bash
# UserPromptSubmit hook: mirror user prompt to Teams (filtered by cwd whitelist).

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
