#!/bin/bash
# disconnect-teams: Stop syncing and optionally stop Bot/Playground

STATE_FILE="$HOME/.claude/teams-session"

if [ ! -f "$STATE_FILE" ]; then
  echo "Not connected to Teams."
  exit 0
fi

SESSION_ID=$(sed -n '1p' "$STATE_FILE")
rm -f "$STATE_FILE"
echo "Disconnected terminal session [$SESSION_ID]."
echo "Hooks will no longer push messages to Teams."
echo ""
echo "Note: Bot and Playground are still running."
echo "To stop them, kill their processes manually or close the terminal."
