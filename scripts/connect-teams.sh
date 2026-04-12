#!/bin/bash
# connect-teams: One command to start everything and connect terminal to Teams
# Usage: connect-teams [session_name] [bot_port] [playground_port]
# Example: connect-teams
#          connect-teams task-1
#          connect-teams task-1 3978 56150

SESSION_ID="${1:-}"
BOT_PORT="${2:-3978}"
PLAYGROUND_PORT="${3:-56150}"
BOT_URL="http://localhost:${BOT_PORT}"
STATE_FILE="$HOME/.claude/teams-session"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== TeamBot Connect ==="
echo ""

# ── Step 1: Get this terminal's Claude session ID ──
# Find the Claude project dir for the current working directory
# Claude Code stores sessions as ~/.claude/projects/<encoded-path>/<session-id>.jsonl
CLAUDE_SESSION_ID=""
ENCODED_CWD=$(node "$PROJECT_DIR/scripts/encode-cwd.js" 2>/dev/null)

CLAUDE_PROJECT_DIR="$HOME/.claude/projects/${ENCODED_CWD}"

if [ -d "$CLAUDE_PROJECT_DIR" ]; then
  # Most recently modified .jsonl file is the current session
  LATEST_SESSION=$(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -1)
  if [ -n "$LATEST_SESSION" ]; then
    CLAUDE_SESSION_ID=$(basename "$LATEST_SESSION" .jsonl)
  fi
fi

# Default session name: argument > "mirror-" + first 8 chars of Claude session ID > "mirror"
if [ -z "$SESSION_ID" ]; then
  if [ -n "$CLAUDE_SESSION_ID" ]; then
    SESSION_ID="mirror-${CLAUDE_SESSION_ID:0:8}"
  else
    SESSION_ID="mirror"
  fi
fi

# ── Step 2: Start Bot if not running ──
BOT_RUNNING=$(curl -s -o /dev/null -w "%{http_code}" "$BOT_URL/api/inbox" -X POST -H "Content-Type: application/json" -d '{"session_id":"ping"}' 2>/dev/null)

if [ "$BOT_RUNNING" != "200" ]; then
  echo "[1/4] Starting Bot on port ${BOT_PORT}..."
  cd "$PROJECT_DIR"
  PORT=$BOT_PORT npx ts-node ./index.ts > /dev/null 2>&1 &
  BOT_PID=$!
  echo "      Bot PID: $BOT_PID"

  # Wait for Bot to be ready
  for i in $(seq 1 15); do
    sleep 1
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BOT_URL/api/inbox" -X POST -H "Content-Type: application/json" -d '{"session_id":"ping"}' 2>/dev/null)
    if [ "$STATUS" = "200" ]; then
      break
    fi
  done

  if [ "$STATUS" != "200" ]; then
    echo "      ERROR: Bot failed to start"
    exit 1
  fi
  echo "      Bot ready."
else
  echo "[1/4] Bot already running on port ${BOT_PORT}."
fi

# ── Step 3: Start Playground if not running ──
PG_RUNNING=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PLAYGROUND_PORT}" 2>/dev/null)

if [ "$PG_RUNNING" = "000" ]; then
  echo "[2/4] Starting Playground on port ${PLAYGROUND_PORT}..."
  agentsplayground start --app-endpoint "$BOT_URL/api/messages" --port "$PLAYGROUND_PORT" > /dev/null 2>&1 &
  PG_PID=$!
  echo "      Playground PID: $PG_PID"

  # Wait for Playground to be ready
  for i in $(seq 1 10); do
    sleep 1
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PLAYGROUND_PORT}" 2>/dev/null)
    if [ "$STATUS" != "000" ]; then
      break
    fi
  done
  echo "      Playground ready."
else
  echo "[2/4] Playground already running on port ${PLAYGROUND_PORT}."
fi

# ── Step 4: Register terminal session with Bot ──
echo "[3/4] Registering terminal session [${SESSION_ID}]..."

if [ -n "$CLAUDE_SESSION_ID" ]; then
  REGISTER_BODY="{\"session_id\":\"${SESSION_ID}\",\"claude_session_id\":\"${CLAUDE_SESSION_ID}\"}"
else
  REGISTER_BODY="{\"session_id\":\"${SESSION_ID}\"}"
fi

RESULT=$(curl -s -X POST "$BOT_URL/api/register" \
  -H "Content-Type: application/json" \
  -d "$REGISTER_BODY" 2>/dev/null)

if [ -n "$CLAUDE_SESSION_ID" ]; then
  echo "      Claude session: ${CLAUDE_SESSION_ID:0:8}... (auto-bound)"
fi

# ── Step 5: Save session state for hooks ──
echo "[4/4] Configuring hooks..."
printf '%s\n%s\n%s\n' "$SESSION_ID" "$BOT_URL" "$CLAUDE_SESSION_ID" > "$STATE_FILE"

echo ""
echo "=== Connected! ==="
echo ""
echo "  Terminal session:  ${SESSION_ID}"
echo "  Bot:               ${BOT_URL}"
echo "  Playground:        http://localhost:${PLAYGROUND_PORT}"
if [ -n "$CLAUDE_SESSION_ID" ]; then
  echo "  Claude session:    ${CLAUDE_SESSION_ID:0:8}... (auto-bound to Playground)"
fi
echo ""
echo "  Your input and Claude's responses will sync to Teams automatically."
echo "  Teams messages share the same Claude context as this terminal."
echo "  Run 'bash scripts/disconnect-teams.sh' to stop."
