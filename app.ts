import { stripMentionsText, TokenCredentials } from "@microsoft/teams.api";
import { App } from "@microsoft/teams.apps";
import { LocalStorage } from "@microsoft/teams.common";
import config from "./config";
import { ManagedIdentityCredential } from "@azure/identity";
import { SessionStore } from "./session-store";
import { ClaudeCodeBridge } from "./claude-bridge";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as https from "https";

const LOG_FILE = path.join(__dirname, "teams-messages.log");

function logToFile(tag: string, content: string) {
  const timestamp = new Date().toLocaleTimeString();
  const line = `[${timestamp}] ${tag}: ${content}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(line.trimEnd());
}

// Create storage for conversation history
const storage = new LocalStorage();

const createTokenFactory = () => {
  return async (scope: string | string[], tenantId?: string): Promise<string> => {
    const managedIdentityCredential = new ManagedIdentityCredential({
      clientId: process.env.CLIENT_ID,
    });
    const scopes = Array.isArray(scope) ? scope : [scope];
    const tokenResponse = await managedIdentityCredential.getToken(scopes, {
      tenantId: tenantId,
    });
    return tokenResponse.token;
  };
};

const tokenCredentials: TokenCredentials = {
  clientId: process.env.CLIENT_ID || "",
  token: createTokenFactory(),
};

const credentialOptions =
  config.MicrosoftAppType === "UserAssignedMsi" ? { ...tokenCredentials } : undefined;

const app = new App({
  ...credentialOptions,
  storage,
});

const sessionStore = new SessionStore();

const claudeBridge = new ClaudeCodeBridge({
  cliPath: config.ClaudeCliPath,
  model: config.ClaudeModel,
  workingDirectory: config.ClaudeWorkingDir,
  timeoutMs: config.ClaudeTimeoutMs,
  maxBudgetUsd: config.ClaudeMaxBudgetUsd,
  bare: config.ClaudeBare,
  permissionMode: config.ClaudePermissionMode,
  systemPrompt: config.ClaudeSystemPrompt,
}, sessionStore);

// Store serviceUrl and conversationId from incoming activities
let lastServiceUrl: string | null = null;
let lastConversationId: string | null = null;

// Send a proactive message — tries app.send() first, falls back to sendDirect (for Playground)
async function pushToTeams(conversationId: string, text: string): Promise<void> {
  try {
    await app.send(conversationId, { type: "message", text });
  } catch {
    // Fallback: direct connector API (works for Playground without auth)
    const serviceUrl = lastServiceUrl || sessionStore.getConnectorUrl();
    if (serviceUrl) {
      await sendDirect(serviceUrl, conversationId, text);
    }
  }
}

// Send a message directly via Bot Framework connector API (works with Playground)
async function sendDirect(serviceUrl: string, conversationId: string, text: string): Promise<void> {
  const url = `${serviceUrl}/v3/conversations/${conversationId}/activities`;
  const body = JSON.stringify({
    type: "message",
    text,
    from: { id: "bot", name: "Claude Code Bot" },
    channelId: "msteams",
  });

  return new Promise<void>((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      res.resume();
      res.on("end", () => resolve());
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) {
      splitAt = maxLength;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

// Helper to send a potentially long message via context.send()
async function sendToTeams(context: any, text: string): Promise<void> {
  if (text.length > 25000) {
    for (const chunk of splitMessage(text, 25000)) {
      await context.send(chunk);
    }
  } else {
    await context.send(text);
  }
}

// ── Message handler ──

app.on("message", async (context) => {
  const activity = context.activity;
  const text: string = stripMentionsText(activity);
  const from = activity.from?.name || activity.from?.id || "unknown";
  const conversationId = activity.conversation.id;

  logToFile("Teams ← " + from, text);

  // Save serviceUrl and conversationId for /api/push
  if (activity.serviceUrl) {
    lastServiceUrl = activity.serviceUrl;
    sessionStore.setConnectorUrl(activity.serviceUrl);
  }
  lastConversationId = conversationId;
  sessionStore.setChannelConversationId(conversationId);

  // ── Commands ──

  if (text === "/help") {
    await context.send(
      "Claude Code Bot — bridges Claude Code CLI to Teams.\n\n" +
      "Commands:\n" +
      "- /help — Show this help\n" +
      "- /resume — List terminal sessions / bind to a terminal's Claude session\n" +
      "- /reset — Reset Claude session (start fresh)\n" +
      "- /status — Show current session status\n" +
      "- /model <name> — Switch model (e.g. /model opus, /model sonnet)\n" +
      "- /compact — Compact conversation context\n" +
      "- /diag — Show raw activity JSON\n\n" +
      "Any other message is sent to Claude Code for processing."
    );
    return;
  }

  if (text === "/reset") {
    claudeBridge.resetSession(conversationId);
    await context.send("Session reset. Next message will start a new Claude conversation.");
    return;
  }

  if (text.startsWith("/model")) {
    const modelName = text.replace("/model", "").trim();
    const models: Array<{ id: string; label: string }> = [
      { id: "claude-opus-4-6-20250514", label: "Opus 4.6 (1M context)" },
      { id: "claude-sonnet-4-6-20250514", label: "Sonnet 4.6" },
      { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
    ];

    if (!modelName) {
      const current = claudeBridge.getModel();
      const list = models.map((m, i) =>
        `${i + 1}. ${m.label} — ${m.id}${m.id === current ? " ✓" : ""}`
      ).join("\n");
      await context.send(
        `Current model: ${current}\n\n` +
        `Available models:\n${list}\n\n` +
        `Usage: /model <number or name>\nExample: /model 1, /model opus, /model claude-sonnet-4-6-20250514`
      );
    } else {
      // Match by number, short name, or full ID
      const num = parseInt(modelName);
      let matched = num >= 1 && num <= models.length ? models[num - 1] : undefined;
      if (!matched) {
        const lower = modelName.toLowerCase();
        matched = models.find(m =>
          m.id === modelName ||
          m.id.includes(lower) ||
          m.label.toLowerCase().includes(lower)
        );
      }
      if (matched) {
        claudeBridge.setModel(matched.id);
        await context.send(`Model switched to: ${matched.label} (${matched.id})`);
      } else {
        // Allow setting arbitrary model ID
        claudeBridge.setModel(modelName);
        await context.send(`Model set to: ${modelName}`);
      }
    }
    return;
  }

  if (text === "/compact") {
    await context.send("Compacting conversation...");
    try {
      const reply = await claudeBridge.sendMessage(conversationId, "/compact");
      await sendToTeams(context, reply);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await context.send(`Compact failed: ${errMsg}`);
    }
    return;
  }

  if (text === "/status") {
    const status = claudeBridge.getSessionStatus(conversationId);
    if (!status.active) {
      await context.send("No active Claude session for this conversation.");
    } else {
      await context.send(
        `Session: ${status.sessionId}\n` +
        `Messages: ${status.messageCount}\n` +
        `Cost: $${status.totalCostUsd?.toFixed(4)}\n` +
        `Busy: ${status.busy}\n` +
        `Queue: ${status.queueLength}\n` +
        `Last activity: ${status.lastActivity}`
      );
    }
    return;
  }

  if (text === "/diag") {
    await context.send(JSON.stringify(activity, null, 2));
    return;
  }

  if (text.startsWith("/resume")) {
    const target = text.replace("/resume", "").trim();
    if (!target) {
      // List all local Claude Code sessions
      const sessions = claudeBridge.listLocalSessions();
      if (sessions.length === 0) {
        await context.send("No Claude Code sessions found.");
      } else {
        const lines = sessions.map((s, i) =>
          `${i + 1}. \`${s.id}\` — ${s.date} — ${s.messageCount} msgs${s.preview ? ` — ${s.preview}` : ""}`
        );
        await context.send(
          "Local Claude Code sessions:\n" + lines.join("\n") +
          "\n\nUsage: /resume <number or session_id>\nExample: /resume 1"
        );
      }
    } else {
      // Match by number or session ID
      let sessionId = target;
      const num = parseInt(target);
      if (num >= 1) {
        const sessions = claudeBridge.listLocalSessions();
        if (num <= sessions.length) {
          sessionId = sessions[num - 1].id;
        }
      }
      // Also check terminal sessions
      const thread = sessionStore.getThread(target);
      if (thread) {
        const claudeId = sessionStore.getTerminalClaudeSessionId(target);
        if (claudeId) {
          sessionId = claudeId;
        }
      }
      // Bind to the session
      sessionStore.setClaudeSessionId(conversationId, sessionId);
      claudeBridge.bindSession(conversationId, sessionId);
      await context.send(`Resumed session \`${sessionId}\`\nYour messages now continue this Claude conversation.`);
    }
    return;
  }

  // ── Forward to Claude Code CLI ──

  await context.send("Thinking...");
  try {
    logToFile("Claude →", `Sending to Claude CLI: ${text.slice(0, 200)}`);
    const reply = await claudeBridge.sendMessage(conversationId, text);
    logToFile("Claude ←", `Reply: ${reply.slice(0, 200)}`);
    await sendToTeams(context, reply);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logToFile("Claude ERROR", errMsg);
    await context.send(`Error: ${errMsg}`);
  }
});

// ── HTTP API for terminal hooks ──

// POST /api/register - Terminal registers a session
app.server.registerRoute("POST", "/api/register", async (req) => {
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const sessionId = body?.session_id;
    const claudeSessionId = body?.claude_session_id;

    if (!sessionId) {
      return { status: 400, body: JSON.stringify({ error: "Missing session_id" }) };
    }

    const existing = sessionStore.getThread(sessionId);
    if (existing) {
      logToFile("Register", `Session ${sessionId} reconnected`);
    } else {
      const channelConvId = sessionStore.getChannelConversationId();
      sessionStore.registerThread(sessionId, channelConvId || "", "");
      logToFile("Register", `Session ${sessionId} registered`);
    }

    // Save terminal's Claude session ID (for /resume command)
    if (claudeSessionId) {
      sessionStore.setTerminalClaudeSessionId(sessionId, claudeSessionId);
    }

    return { status: 200, body: JSON.stringify({ ok: true, session_id: sessionId, reused: !!existing }) };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logToFile("Register ERROR", errMsg);
    return { status: 500, body: JSON.stringify({ error: errMsg }) };
  }
});

// POST /api/push - Terminal pushes a message to Teams
app.server.registerRoute("POST", "/api/push", async (req) => {
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const text = body?.text;
    const sessionId = body?.session_id;

    if (!text) {
      return { status: 400, body: JSON.stringify({ error: "Missing 'text' field" }) };
    }
    if (!sessionId) {
      return { status: 400, body: JSON.stringify({ error: "Missing 'session_id' field" }) };
    }

    logToFile("Push", `[${sessionId}] ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`);

    // Save terminal's Claude session ID if provided (for /resume)
    const claudeSessionId = body?.claude_session_id;
    if (claudeSessionId) {
      sessionStore.setTerminalClaudeSessionId(sessionId, claudeSessionId);
    }
    // Determine conversationId
    const conversationId = lastConversationId || sessionStore.getChannelConversationId();

    if (!conversationId) {
      return {
        status: 503,
        body: JSON.stringify({ error: "Bot has not received any Teams message yet. Send a message in Teams first." }),
      };
    }

    // Send to Teams
    const fullText = `[${sessionId}] ${text}`;
    if (fullText.length > 25000) {
      for (const chunk of splitMessage(fullText, 25000)) {
        await pushToTeams(conversationId, chunk);
      }
    } else {
      await pushToTeams(conversationId, fullText);
    }

    return { status: 200, body: JSON.stringify({ ok: true }) };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logToFile("Push ERROR", errMsg);
    return { status: 500, body: JSON.stringify({ error: errMsg }) };
  }
});

// POST /api/inbox - Terminal polls for messages from Teams
app.server.registerRoute("POST", "/api/inbox", async (req) => {
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const sessionId = body?.session_id;
    if (!sessionId) {
      return { status: 400, body: JSON.stringify({ error: "Missing session_id" }) };
    }
    const messages = sessionStore.readInbox(sessionId);
    return { status: 200, body: JSON.stringify({ messages }) };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { status: 500, body: JSON.stringify({ error: errMsg }) };
  }
});

// POST /api/handoff - Terminal hands off its Claude session to Teams
app.server.registerRoute("POST", "/api/handoff", async (req) => {
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const claudeSessionId = body?.claude_session_id;

    if (!claudeSessionId) {
      return { status: 400, body: JSON.stringify({ error: "Missing claude_session_id" }) };
    }

    // Bind all known conversations to this Claude session
    const convId = lastConversationId || sessionStore.getChannelConversationId();
    if (convId) {
      sessionStore.setClaudeSessionId(convId, claudeSessionId);
      claudeBridge.bindSession(convId, claudeSessionId);
      logToFile("Handoff", `Teams bound to Claude session ${claudeSessionId.slice(0, 8)}...`);
    }

    return { status: 200, body: JSON.stringify({ ok: true, claude_session_id: claudeSessionId }) };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logToFile("Handoff ERROR", errMsg);
    return { status: 500, body: JSON.stringify({ error: errMsg }) };
  }
});

// POST /api/takeback - Terminal takes back its Claude session from Teams
app.server.registerRoute("POST", "/api/takeback", async (req) => {
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const claudeSessionId = body?.claude_session_id;

    // Remove binding — Teams will create independent sessions again
    const convId = lastConversationId || sessionStore.getChannelConversationId();
    if (convId) {
      sessionStore.removeClaudeSession(convId);
      claudeBridge.resetSession(convId);
      logToFile("Takeback", `Teams unbound from Claude session ${claudeSessionId?.slice(0, 8) || "unknown"}...`);
    }

    return { status: 200, body: JSON.stringify({ ok: true }) };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { status: 500, body: JSON.stringify({ error: errMsg }) };
  }
});

export default app;
