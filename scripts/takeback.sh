#!/bin/bash
# takeback.sh — Resume Claude session back to terminal after handoff
# Run this when you're back at your desk.

STATE_FILE="$HOME/.claude/teams-handoff"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$STATE_FILE" ]; then
  echo "No handoff session found. Nothing to take back."
  exit 0
fi

source "$STATE_FILE"
BOT_URL="${BOT_URL:-http://localhost:3978}"

if [ -z "$CLAUDE_SESSION_ID" ]; then
  echo "ERROR: No session ID in handoff file."
  exit 1
fi

# Tell Bot to stop using this session (go back to independent mode)
curl -s -X POST "$BOT_URL/api/takeback" \
  -H "Content-Type: application/json" \
  -d "{\"claude_session_id\":\"${CLAUDE_SESSION_ID}\"}" > /dev/null 2>&1

rm -f "$STATE_FILE"

echo ""
echo "=== Session Taken Back ==="
echo ""
echo "  Claude session: ${CLAUDE_SESSION_ID:0:8}..."
echo ""
echo "  Resume your terminal session:"
echo "    claude --resume ${CLAUDE_SESSION_ID}"
echo ""
echo "  Teams will switch to independent Claude sessions."
