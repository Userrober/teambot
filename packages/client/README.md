# claude-teams-client

Bridge a Microsoft Teams bot to your local Claude Code CLI. Install once, pair once, then chat with Claude from Teams on any device — Claude runs on **your** computer, with **your** account, against **your** working directory.

## What this does

You install this on your computer. It maintains a WebSocket connection to a Teams bot (run by you or someone you trust). When messages arrive in Teams, the bot routes them to this client, which spawns the local `claude` CLI and sends the reply back. Each user has their own client → their own Claude → their own files. Nobody can see anyone else's session.

## Install

```bash
npm install -g claude-teams-client
```

Requirements:

- **Node.js 20+**
- **Claude Code CLI** already installed and signed in:
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude   # first-time login
  ```

## Configure

Point the client at the bot's WebSocket URL (the person who runs the bot will give you this):

```bash
claude-teams-client config --bot-url wss://example.com/ws
```

Or set it via env var: `BOT_WS_URL=wss://example.com/ws`.

## First-time pairing

Start the client:

```bash
claude-teams-client
```

It prints something like:

```
┌────────────────────────────────────────────────────────────
│  Claude Teams Client
│  Token:    2ac42715-b623-4c0f-b4a8-d9b4f22f401b
│  Bot URL:  wss://example.com/ws
│  In Teams, send this command once to bind your account:
│    /pair 2ac42715-b623-4c0f-b4a8-d9b4f22f401b
└────────────────────────────────────────────────────────────
```

In the Teams bot chat, send:

```
/pair 2ac42715-b623-4c0f-b4a8-d9b4f22f401b
```

You'll see `✓ Paired`. **This binding is permanent** — you only do it once per device.

## Daily use

Just keep the client running:

```bash
claude-teams-client
```

Then send messages in Teams. They reach the `claude` CLI on your computer, with your working directory.

To switch to a different project: stop the client (`Ctrl+C`), `cd` into the new directory, start it again. Same token, no re-pairing needed.

## Commands

| Command | What it does |
|---|---|
| `claude-teams-client` (or `start`) | Run the daemon (default) |
| `claude-teams-client status` | Print current token, bot URL, config path |
| `claude-teams-client config --bot-url <url>` | Set the bot URL |
| `claude-teams-client reset-token` | Generate a new token (requires re-pairing in Teams) |
| `claude-teams-client help` | Show usage |

## In Teams

| Command | What it does |
|---|---|
| `/help` | Show help |
| `/pair <token>` | Bind your Teams account to a client |
| `/unpair` | Remove your binding |
| `/whoami` | Show your pairing status |
| `/status` | Show current Claude session info |
| `/model` / `/model <name>` | View / switch models |
| `/reset` | Drop the current Claude session, start fresh next time |
| `/compact` | Compact the conversation context |
| `/resume` | List local Claude sessions |
| `/resume <number or id>` | Resume a specific session |
| anything else | Sent to Claude |

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `BOT_WS_URL` | `ws://localhost:3978/ws` | Bot WebSocket URL (overrides config file) |
| `CLAUDE_CLI_PATH` | `claude` (or `claude.cmd` on Windows) | Path to the claude binary |
| `CLAUDE_MODEL` | `claude-opus-4-6-20250514` | Default model |
| `CLAUDE_WORKING_DIR` | current working dir | Where Claude operates |
| `CLAUDE_TIMEOUT_MS` | `300000` | Per-message timeout |
| `CLAUDE_PERMISSION_MODE` | `auto` | `auto` / `acceptEdits` / `bypassPermissions` |
| `CLAUDE_MAX_BUDGET_USD` | `0` (no limit) | Per-message budget cap |
| `CLAUDE_BARE` | unset | If `true`, disable Claude system prompt |
| `CLAUDE_SYSTEM_PROMPT` | unset | Append a system prompt |

Config file: `~/.claude-teams-client/config.json`

## Running in the background

The client must stay running for Teams messages to reach you. Common options:

**macOS/Linux (pm2):**
```bash
npm install -g pm2
pm2 start claude-teams-client --name claude-teams
pm2 save
```

**Windows (Task Scheduler):** Create a task that runs `claude-teams-client` at logon.

## Troubleshooting

**"Your client is offline" in Teams**
- The client process isn't running, or its WebSocket dropped. Restart it.

**"You are not paired yet"**
- Run the client, copy the printed token, send `/pair <token>` in Teams.

**Different computer**
- Install the client there, run it (it generates a new token), `/pair <new-token>` in Teams. The old binding is automatically replaced.

**Token leaked**
- Run `claude-teams-client reset-token`, then `/pair <new-token>` in Teams.

## License

MIT
