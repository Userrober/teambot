# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Microsoft Teams bot that serves as a frontend for Claude Code CLI. Users send messages in Teams, the bot forwards them to a local Claude Code process, and sends Claude's responses back to Teams. Built on the Microsoft 365 Agents Toolkit (v1.11) using the Microsoft Teams SDK 2.0 (`@microsoft/teams.apps`).

### Two Usage Scenarios

**Scenario 1: Mirror (Terminal → Teams push)**

Terminal Claude Code conversations are automatically pushed to Teams in real-time. You can monitor Claude's work from your phone.

```bash
# Start mirroring — terminal messages sync to Teams
npm run connect

# Stop mirroring
npm run disconnect
```

**Scenario 2: Session Sharing (Teams ↔ Terminal)**

Teams can pick up any local Claude Code session and continue the conversation. Useful for handoff between desktop and mobile.

```bash
# In Teams, list all local Claude Code sessions:
/resume

# Output example:
# 1. `209ddf7d-da21-461a-bba9-b29dc933d32e` — 04/15 14:35 — 12 msgs — 帮我写一个登录页面
# 2. `a1b2c3d4-e5f6-7890-abcd-ef1234567890` — 04/15 10:20 — 5 msgs — Fix the API endpoint

# Resume a session by number:
/resume 1

# Or by full session ID:
/resume 209ddf7d-da21-461a-bba9-b29dc933d32e

# Handoff terminal session to Teams (run in Claude Code terminal):
! bash scripts/handoff.sh

# Take back to terminal:
bash scripts/takeback.sh
claude --resume <session-id>

# Check current session info in Teams:
/status

# Reset and start fresh:
/reset
```

## Teams Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help message |
| `/reset` | Reset Claude session (start fresh) |
| `/status` | Show current session status (ID, messages, cost, activity) |
| `/model` | List available models with current selection |
| `/model <number or name>` | Switch model (e.g. `/model 1`, `/model opus`, `/model claude-sonnet-4-6-20250514`) |
| `/compact` | Compact conversation context to reduce token usage |
| `/resume` | List all local Claude Code sessions (up to 10, sorted by recent) |
| `/resume <number or ID>` | Resume/bind to a specific Claude Code session |
| `/diag` | Show raw Teams activity JSON (for debugging) |

Any other message is forwarded to Claude Code for processing.

## Commands

```bash
# Install dependencies
npm install

# Build (TypeScript compilation)
npm run build

# One-time setup (install deps, build, configure hooks)
npm run setup

# Interactive configuration wizard (Dev Tunnel + Bot registration + packaging)
node scripts/configure.js

# Start bot with Teams (loads .localConfigs, starts Dev Tunnel)
npm run start:teams

# Stop all processes
npm run stop

# Connect terminal mirroring
npm run connect

# Disconnect terminal mirroring
npm run disconnect

# Local development with hot reload (port 3978, debugger on 9239)
npm run dev

# Run compiled output
npm run start
```

There are no tests configured (`npm test` is a placeholder).

## Architecture

- **`index.ts`** - Entry point. Starts the app on `PORT` env var (default 3978).
- **`app.ts`** - Bot logic. Creates the `App` instance with credentials and `LocalStorage`, registers the `message` event handler with command routing. Non-command messages are forwarded to Claude Code via the bridge.
- **`claude-bridge.ts`** - `ClaudeCodeBridge` class. Manages per-conversation Claude Code sessions. Spawns `claude -p --output-format json --permission-mode auto --resume <sessionId>` for each message. Handles message queuing, error recovery, session lifecycle, and local session listing.
- **`claude-types.ts`** - TypeScript interfaces for Claude CLI JSON output, bridge config, and conversation session state.
- **`config.ts`** - Maps environment variables (`CLIENT_ID`, `CLIENT_SECRET`, `TENANT_ID`, `CLAUDE_*`) to config properties.
- **`session-store.ts`** - Persists conversation-to-session mappings. Tracks terminal sessions and Claude session IDs.

**Authentication:** Uses `ManagedIdentityCredential` from `@azure/identity` when `BOT_TYPE=UserAssignedMsi` (Azure deployment). Local dev uses client secret via `.localConfigs`.

**State:** Per-conversation state stored in `LocalStorage` (in-memory), keyed by conversation ID. Tracks message count.

## Environment Configuration

Configuration is stored in `.localConfigs` (created by `node scripts/configure.js`).

Key env vars: `CLIENT_ID`, `CLIENT_SECRET`, `TENANT_ID`, `PORT`.

Claude Code env vars: `CLAUDE_CLI_PATH`, `CLAUDE_MODEL`, `CLAUDE_WORKING_DIR`, `CLAUDE_TIMEOUT_MS`, `CLAUDE_MAX_BUDGET_USD`, `CLAUDE_BARE`, `CLAUDE_PERMISSION_MODE`, `CLAUDE_SYSTEM_PROMPT`.

Default permission mode is `auto` (safe non-interactive mode with built-in security rules). Can be set to `bypassPermissions` for full access or `acceptEdits` for edit-only auto-accept.

## Infrastructure

Azure deployment defined in Bicep templates under `infra/`:
- `azure.bicep` - App Service (B1), Managed Identity, bot registration
- `botRegistration/azurebot.bicep` - Bot Framework service + Teams channel

## Development Workflow

The primary development flow uses `npm run start:teams` which loads `.localConfigs` and starts the Dev Tunnel automatically. For VS Code with M365 Agents Toolkit extension, press F5 to launch.

Prerequisites: Node.js 20+, Git Bash (Windows), Claude Code CLI, Dev Tunnel CLI.
