#!/bin/bash
# handoff.sh — Hand off Claude session from terminal to Teams
# Run this before leaving the terminal. Then exit Claude Code.
# Teams will resume the same Claude session.

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BOT_URL="${1:-http://localhost:3978}"
STATE_FILE="$HOME/.claude/teams-handoff"

# Find current Claude session ID
ENCODED_CWD=$(node "$PROJECT_DIR/scripts/encode-cwd.js" 2>/dev/null)
CLAUDE_PROJECT_DIR="$HOME/.claude/projects/${ENCODED_CWD}"

CLAUDE_SESSION_ID=""
if [ -d "$CLAUDE_PROJECT_DIR" ]; then
  LATEST_SESSION=$(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -1)
  if [ -n "$LATEST_SESSION" ]; then
    CLAUDE_SESSION_ID=$(basename "$LATEST_SESSION" .jsonl)
  fi
fi

if [ -z "$CLAUDE_SESSION_ID" ]; then
  echo "ERROR: Could not find Claude session ID."
  exit 1
fi

# Save handoff state
cat > "$STATE_FILE" << EOF
CLAUDE_SESSION_ID=${CLAUDE_SESSION_ID}
BOT_URL=${BOT_URL}
CWD=${PROJECT_DIR}
EOF

# Tell Bot to use this session ID for Teams conversations
RESULT=$(curl -s -X POST "$BOT_URL/api/handoff" \
  -H "Content-Type: application/json" \
  -d "{\"claude_session_id\":\"${CLAUDE_SESSION_ID}\"}" 2>/dev/null)

ERROR=$(echo "$RESULT" | node -e "
  try { const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(d.error) process.stdout.write(d.error); }
  catch {}
" 2>/dev/null)

if [ -n "$ERROR" ]; then
  echo "ERROR: $ERROR"
  rm -f "$STATE_FILE"
  exit 1
fi

echo ""
echo "=== Handoff Ready ==="
echo ""
echo "  Claude session: ${CLAUDE_SESSION_ID:0:8}..."
echo "  Bot: ${BOT_URL}"
echo ""
echo "  Now exit Claude Code (/exit or Ctrl+C)."
echo "  Then continue your work from Teams."
echo ""
echo "  When you come back, run:"
echo "    claude --resume ${CLAUDE_SESSION_ID}"
echo "  Or:"
echo "    bash scripts/takeback.sh"
