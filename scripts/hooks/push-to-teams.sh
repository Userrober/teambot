#!/bin/bash
# Stop hook: mirror assistant's last response to Teams (filtered by cwd whitelist).

INPUT=$(cat)

DATA=$(node -e "
  try {
    const i = JSON.parse(require('fs').readFileSync(0,'utf8'));
    let text = i.last_assistant_message || i.response || i.message || '';
    if (!text && i.transcript_path) {
      const fs = require('fs');
      try {
        const lines = fs.readFileSync(i.transcript_path,'utf8').trim().split('\n');
        for (let j = lines.length - 1; j >= 0; j--) {
          const obj = JSON.parse(lines[j]);
          if (obj.type === 'assistant' && obj.message) {
            const c = obj.message.content;
            if (typeof c === 'string') { text = c; break; }
            if (Array.isArray(c)) {
              text = c.filter(b => b.type === 'text').map(b => b.text).join('\n');
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
