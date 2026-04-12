#!/bin/bash
# Claude Code Stop hook: push assistant's response to Teams via Bot /api/push
# Only pushes if this is the terminal session that ran connect-teams (not Bot's claude -p)

STATE_FILE="$HOME/.claude/teams-session"

if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

SESSION_ID=$(sed -n '1p' "$STATE_FILE")
BOT_URL=$(sed -n '2p' "$STATE_FILE")
EXPECTED_CLAUDE_SESSION=$(sed -n '3p' "$STATE_FILE")
BOT_URL="${BOT_URL:-http://localhost:3978}"

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

INPUT=$(cat)

# Check if this Claude process is the one we want to mirror
ACTUAL_SESSION=$(node -e "
  const input = JSON.parse(require('fs').readFileSync(0,'utf8'));
  process.stdout.write(input.session_id || '');
" <<< "$INPUT" 2>/dev/null)

# If we have an expected session ID, only push if it matches
if [ -n "$EXPECTED_CLAUDE_SESSION" ] && [ "$ACTUAL_SESSION" != "$EXPECTED_CLAUDE_SESSION" ]; then
  exit 0
fi

RESPONSE=$(node -e "
  const input = JSON.parse(require('fs').readFileSync(0,'utf8'));
  const text = input.last_assistant_message || '';
  process.stdout.write(String(text));
" <<< "$INPUT" 2>/dev/null)

if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "null" ] || [ "$RESPONSE" = "undefined" ]; then
  exit 0
fi

PAYLOAD=$(node -e "
  const o = { session_id: process.argv[1], text: '🤖 Terminal Claude: ' + process.argv[2] };
  if (process.argv[3]) o.claude_session_id = process.argv[3];
  process.stdout.write(JSON.stringify(o));
" "$SESSION_ID" "$RESPONSE" "$ACTUAL_SESSION" 2>/dev/null)

curl -s -X POST "$BOT_URL/api/push" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" > /dev/null 2>&1

exit 0
