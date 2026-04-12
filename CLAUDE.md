# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Microsoft Teams bot that serves as a frontend for Claude Code CLI. Users send messages in Teams, the bot forwards them to a local Claude Code process, and sends Claude's responses back to Teams. Built on the Microsoft 365 Agents Toolkit (v1.11) using the Microsoft Teams SDK 2.0 (`@microsoft/teams.apps`).

Supports slash commands: `/reset`, `/count`, `/diag`, `/state`, `/runtime`, `/newsession`, `/status`, `/help`.

## Commands

```bash
# Install dependencies
npm install

# Build (TypeScript compilation)
npm run build

# Local development with hot reload (port 3978, debugger on 9239)
npm run dev

# Local dev with Teams Toolkit environment
npm run dev:teamsfx

# Local dev with M365 Agents Playground
npm run dev:teamsfx:playground

# Run compiled output
npm run start
```

There are no tests configured (`npm test` is a placeholder).

## Architecture

- **`index.ts`** - Entry point. Starts the app on `PORT` env var (default 3978).
- **`app.ts`** - Bot logic. Creates the `App` instance with credentials and `LocalStorage`, registers the `message` event handler with command routing. Non-command messages are forwarded to Claude Code via the bridge.
- **`claude-bridge.ts`** - `ClaudeCodeBridge` class. Manages per-conversation Claude Code sessions. Spawns `claude -p --output-format json --resume <sessionId>` for each message. Handles message queuing, error recovery, and session lifecycle.
- **`claude-types.ts`** - TypeScript interfaces for Claude CLI JSON output, bridge config, and conversation session state.
- **`config.ts`** - Maps environment variables (`CLIENT_ID`, `CLIENT_PASSWORD`, `BOT_TYPE`, `TENANT_ID`, `CLAUDE_*`) to config properties.

**Authentication:** Uses `ManagedIdentityCredential` from `@azure/identity` when `BOT_TYPE=UserAssignedMsi` (Azure deployment). Local dev uses client secret via M365 Agents Toolkit provisioning.

**State:** Per-conversation state stored in `LocalStorage` (in-memory), keyed by conversation ID. Tracks message count.

## Environment Configuration

Environment files live in `env/`. The toolkit generates `.localConfigs` at deploy time with runtime variables.

Key env vars: `CLIENT_ID`, `CLIENT_SECRET` (local only), `TENANT_ID`, `BOT_TYPE`, `PORT`, `RUNNING_ON_AZURE`.

Claude Code env vars: `CLAUDE_CLI_PATH`, `CLAUDE_MODEL`, `CLAUDE_WORKING_DIR`, `CLAUDE_TIMEOUT_MS`, `CLAUDE_MAX_BUDGET_USD`, `CLAUDE_BARE`, `CLAUDE_SKIP_PERMISSIONS`, `CLAUDE_SYSTEM_PROMPT`.

## Infrastructure

Azure deployment defined in Bicep templates under `infra/`:
- `azure.bicep` - App Service (B1), Managed Identity, bot registration
- `botRegistration/azurebot.bicep` - Bot Framework service + Teams channel

## Development Workflow

The primary development flow uses VS Code with the M365 Agents Toolkit extension. Press F5 to launch in the M365 Agents Playground or Teams (Edge/Chrome/Desktop). The toolkit handles tunnel setup, provisioning, and environment configuration.

Prerequisites: Node.js 20 or 22, M365 Agents Toolkit VS Code extension 5.0.0+.
