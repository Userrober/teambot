#!/bin/bash
# stop.sh — Stop TeamBot processes (Bot + dev tunnel)
# Usage: bash scripts/stop.sh

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$PROJECT_DIR/.teambot.pids"

echo "=== TeamBot Stop ==="
echo ""

STOPPED=0

# ── Kill saved PIDs ──
if [ -f "$PID_FILE" ]; then
  while read -r PID; do
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null
      echo "  Stopped process $PID"
      STOPPED=$((STOPPED + 1))
    fi
  done < "$PID_FILE"
  rm -f "$PID_FILE"
fi

# ── Also kill any remaining processes on Bot port ──
BOT_PORT="${PORT:-3978}"
PORT_PIDS=$(lsof -ti ":$BOT_PORT" 2>/dev/null || netstat -ano 2>/dev/null | grep ":$BOT_PORT" | grep LISTENING | awk '{print $5}' | sort -u)
if [ -n "$PORT_PIDS" ]; then
  for PID in $PORT_PIDS; do
    if [ -n "$PID" ] && [ "$PID" != "0" ]; then
      kill "$PID" 2>/dev/null && echo "  Stopped process $PID (port $BOT_PORT)" && STOPPED=$((STOPPED + 1))
    fi
  done
fi

# ── Kill devtunnel processes ──
if command -v taskkill &> /dev/null; then
  # Windows
  taskkill //F //IM devtunnel.exe > /dev/null 2>&1 && echo "  Stopped devtunnel" && STOPPED=$((STOPPED + 1))
else
  # Unix
  pkill -f "devtunnel host" 2>/dev/null && echo "  Stopped devtunnel" && STOPPED=$((STOPPED + 1))
fi

# ── Clean up log files ──
rm -f "$PROJECT_DIR/.bot.log" "$PROJECT_DIR/.tunnel.log"

if [ "$STOPPED" -eq 0 ]; then
  echo "  No running TeamBot processes found."
else
  echo ""
  echo "  Stopped $STOPPED process(es)."
fi

echo ""
echo "=== TeamBot Stopped ==="
