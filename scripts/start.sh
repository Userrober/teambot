#!/bin/bash
# start.sh — Start TeamBot (dev tunnel + Bot server)
# Usage: bash scripts/start.sh

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BOT_PORT="${PORT:-3978}"
PID_FILE="$PROJECT_DIR/.teambot.pids"

echo "=== TeamBot Start ==="
echo ""

# ── Check prerequisites ──
if [ ! -f "$PROJECT_DIR/.localConfigs" ]; then
  echo "ERROR: .localConfigs not found."
  echo "You need to complete one-time Teams setup first. See README.md."
  exit 1
fi

if ! command -v devtunnel &> /dev/null; then
  echo "ERROR: Dev Tunnel CLI not found."
  echo "Install it: winget install Microsoft.devtunnel"
  exit 1
fi

# ── Check if already running ──
if [ -f "$PID_FILE" ]; then
  echo "TeamBot may already be running. Run 'npm run stop' first."
  echo ""
fi

# ── Find tunnel ID ──
echo "[1/3] Finding dev tunnel..."
TUNNEL_ID=$(devtunnel list 2>/dev/null | grep -oP '^\S+' | tail -1)

if [ -z "$TUNNEL_ID" ]; then
  echo "  ERROR: No dev tunnel found."
  echo "  Create one first:"
  echo "    devtunnel create --allow-anonymous"
  echo "    devtunnel port create -p 3978"
  exit 1
fi
echo "  Tunnel: $TUNNEL_ID"

# ── Start dev tunnel ──
echo "[2/3] Starting dev tunnel..."
nohup devtunnel host "$TUNNEL_ID" > "$PROJECT_DIR/.tunnel.log" 2>&1 &
TUNNEL_PID=$!
echo "  Tunnel PID: $TUNNEL_PID"

# Wait for tunnel to be ready
for i in $(seq 1 10); do
  sleep 1
  if grep -q "Ready to accept connections" "$PROJECT_DIR/.tunnel.log" 2>/dev/null; then
    break
  fi
done

TUNNEL_URL=$(grep -oP 'https://\S+-3978\.\S+' "$PROJECT_DIR/.tunnel.log" 2>/dev/null | head -1)
if [ -n "$TUNNEL_URL" ]; then
  echo "  Tunnel URL: $TUNNEL_URL"
else
  echo "  WARNING: Could not detect tunnel URL. Check .tunnel.log"
fi

# ── Start Bot ──
echo "[3/3] Starting Bot on port $BOT_PORT..."
cd "$PROJECT_DIR"
nohup bash -c "source .localConfigs && PORT=$BOT_PORT npx ts-node ./index.ts" > "$PROJECT_DIR/.bot.log" 2>&1 &
BOT_PID=$!
echo "  Bot PID: $BOT_PID"

# Wait for Bot to be ready
for i in $(seq 1 15); do
  sleep 1
  BOT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$BOT_PORT/api/messages" 2>/dev/null)
  if [ "$BOT_STATUS" != "000" ]; then
    break
  fi
done

if [ "$BOT_STATUS" = "000" ]; then
  echo "  WARNING: Bot may not be ready yet. Check .bot.log"
else
  echo "  Bot ready."
fi

# ── Save PIDs for stop.sh ──
echo "$TUNNEL_PID" > "$PID_FILE"
echo "$BOT_PID" >> "$PID_FILE"

echo ""
echo "=== TeamBot Running ==="
echo ""
echo "  Bot:    http://localhost:$BOT_PORT"
if [ -n "$TUNNEL_URL" ]; then
  echo "  Tunnel: $TUNNEL_URL"
fi
echo ""
echo "  Send messages to your Bot in Teams."
echo "  Logs: .bot.log / .tunnel.log"
echo "  Stop: npm run stop"
