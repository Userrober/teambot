#!/bin/bash
# TeamBot Setup — One-time setup for new users
# Run this after cloning the repo and running npm install

set -e

echo "=== TeamBot Setup ==="
echo ""

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_DIR="$HOME/.claude"
HOOKS_DIR="$CLAUDE_DIR/hooks"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

# ── Step 1: Check prerequisites ──
echo "[1/5] Checking prerequisites..."

# Node.js
if ! command -v node &> /dev/null; then
  echo "  ERROR: Node.js not found. Install Node.js 20+ first."
  exit 1
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
echo "  Node.js: $(node -v)"

# Claude Code CLI
if ! command -v claude &> /dev/null; then
  echo "  ERROR: Claude Code CLI not found."
  echo "  Install it: npm install -g @anthropic-ai/claude-code"
  exit 1
fi
echo "  Claude CLI: found"

# ── Step 2: Install dependencies ──
echo "[2/5] Installing dependencies..."
cd "$PROJECT_DIR"
npm install --silent 2>/dev/null
echo "  Done."

# ── Step 3: Install Playground CLI ──
echo "[3/5] Installing Playground CLI..."
if ! command -v agentsplayground &> /dev/null; then
  npm install -g @microsoft/m365agentsplayground --silent 2>/dev/null
  echo "  Installed @microsoft/m365agentsplayground"
else
  echo "  Already installed."
fi

# ── Step 4: Copy hooks ──
echo "[4/5] Setting up Claude Code hooks..."
mkdir -p "$HOOKS_DIR"

cp "$PROJECT_DIR/scripts/push-to-teams.sh" "$HOOKS_DIR/push-to-teams.sh"
cp "$PROJECT_DIR/scripts/push-prompt-to-teams.sh" "$HOOKS_DIR/push-prompt-to-teams.sh"
echo "  Hooks copied to $HOOKS_DIR"

# ── Step 5: Register hooks in settings.json ──
echo "[5/5] Registering hooks..."

if [ -f "$SETTINGS_FILE" ]; then
  # Merge hooks into existing settings
  node -e "
    const fs = require('fs');
    const settings = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf8'));

    const stopHook = {
      matcher: '',
      hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/push-to-teams.sh', timeout: 10 }]
    };
    const promptHook = {
      matcher: '',
      hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/push-prompt-to-teams.sh', timeout: 10 }]
    };

    if (!settings.hooks) settings.hooks = {};

    // Check if already registered
    const hasStop = (settings.hooks.Stop || []).some(h =>
      h.hooks && h.hooks.some(hh => hh.command && hh.command.includes('push-to-teams'))
    );
    const hasPrompt = (settings.hooks.UserPromptSubmit || []).some(h =>
      h.hooks && h.hooks.some(hh => hh.command && hh.command.includes('push-prompt-to-teams'))
    );

    if (!hasStop) {
      if (!settings.hooks.Stop) settings.hooks.Stop = [];
      settings.hooks.Stop.push(stopHook);
    }
    if (!hasPrompt) {
      if (!settings.hooks.UserPromptSubmit) settings.hooks.UserPromptSubmit = [];
      settings.hooks.UserPromptSubmit.push(promptHook);
    }

    fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2));
    console.log('  Hooks registered in settings.json');
  "
else
  # Create new settings file with hooks
  node -e "
    const fs = require('fs');
    const settings = {
      hooks: {
        Stop: [{
          matcher: '',
          hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/push-to-teams.sh', timeout: 10 }]
        }],
        UserPromptSubmit: [{
          matcher: '',
          hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/push-prompt-to-teams.sh', timeout: 10 }]
        }]
      }
    };
    fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2));
    console.log('  Created settings.json with hooks');
  "
fi

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "Usage:"
echo ""
echo "  Playground mode (local browser):"
echo "    bash scripts/connect-teams.sh"
echo "    Open http://localhost:56150"
echo ""
echo "  Teams mode (requires Bot registration + dev tunnel):"
echo "    See SETUP-TEAMS.md for one-time Teams configuration."
echo "    bash scripts/connect-teams.sh"
echo ""
echo "  Stop mirroring:"
echo "    bash scripts/disconnect-teams.sh"
