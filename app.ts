import { stripMentionsText, TokenCredentials } from "@microsoft/teams.api";
import { App } from "@microsoft/teams.apps";
import { ExpressAdapter } from "@microsoft/teams.apps";
import { LocalStorage } from "@microsoft/teams.common";
import config from "./config";
import { ManagedIdentityCredential } from "@azure/identity";
import { SessionStore } from "./session-store";
import { PairingStore } from "./pairing-store";
import { WsHub } from "./ws-hub";
import type { BotToClient, ClientToBot } from "./protocol";
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

// Create our own http.Server so we can attach WebSocket on the same port.
const httpServer = http.createServer();
const httpAdapter = new ExpressAdapter(httpServer);

const app = new App({
  ...credentialOptions,
  storage,
  httpServerAdapter: httpAdapter,
});

const sessionStore = new SessionStore();
const pairingStore = new PairingStore();
const wsHub = new WsHub();

const WS_PATH = process.env.WS_PATH || "/ws";
wsHub.attach(httpServer, WS_PATH);

let lastServiceUrl: string | null = null;

wsHub.setMirrorHandler((token, text) => {
  const aadObjectId = pairingStore.aadFor(token);
  if (!aadObjectId) return;
  const conversationId = pairingStore.conversationFor(aadObjectId);
  if (!conversationId) return;
  const fullText = `[mirror] ${text}`;
  if (fullText.length > 25000) {
    for (const chunk of splitMessage(fullText, 25000)) {
      pushToTeams(conversationId, chunk).catch(() => {});
    }
  } else {
    pushToTeams(conversationId, fullText).catch(() => {});
  }
});

async function pushToTeams(conversationId: string, text: string): Promise<void> {
  try {
    await app.send(conversationId, { type: "message", text });
  } catch {
    const serviceUrl = lastServiceUrl || sessionStore.getConnectorUrl();
    if (serviceUrl) {
      await sendDirect(serviceUrl, conversationId, text);
    }
  }
}

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

async function sendToTeams(context: any, text: string): Promise<void> {
  if (text.length > 25000) {
    for (const chunk of splitMessage(text, 25000)) {
      await context.send(chunk);
    }
  } else {
    await context.send(text);
  }
}

function expectReply(msg: ClientToBot): string {
  if (msg.type === "reply") return msg.text;
  if (msg.type === "error") throw new Error(msg.message);
  throw new Error(`Unexpected client response: ${msg.type}`);
}

app.on("message", async (context) => {
  const activity = context.activity;
  const text: string = stripMentionsText(activity);
  const from = activity.from?.name || activity.from?.id || "unknown";
  const aadObjectId = activity.from?.aadObjectId || activity.from?.id;
  const conversationId = activity.conversation.id;

  logToFile("Teams ← " + from, text);

  if (activity.serviceUrl) {
    lastServiceUrl = activity.serviceUrl;
    sessionStore.setConnectorUrl(activity.serviceUrl);
  }
  if (aadObjectId) {
    pairingStore.setConversation(aadObjectId, conversationId);
  }
  sessionStore.setChannelConversationId(conversationId);

  // ── Commands that don't need a client ──

  if (text === "/help") {
    await context.send(
      "Claude Code Bot — bridges Claude Code CLI to Teams.\n\n" +
      "First-time setup:\n" +
      "- Run the client on your computer, it prints a pairing token\n" +
      "- Send `/pair <token>` here to bind your Teams account\n\n" +
      "Commands:\n" +
      "- /help — Show this help\n" +
      "- /pair <token> — Bind your Teams account to a client\n" +
      "- /unpair — Remove your current binding\n" +
      "- /whoami — Show your pairing status\n" +
      "- /resume — List local sessions / bind to one\n" +
      "- /reset — Reset Claude session (start fresh)\n" +
      "- /status — Show current session status\n" +
      "- /model <name> — Switch model (e.g. /model opus, /model sonnet)\n" +
      "- /compact — Compact conversation context\n" +
      "- /diag — Show raw activity JSON\n\n" +
      "Any other message is sent to Claude Code for processing."
    );
    return;
  }

  if (text === "/diag") {
    await context.send(JSON.stringify(activity, null, 2));
    return;
  }

  if (!aadObjectId) {
    await context.send("Cannot identify your user (missing aadObjectId). Try signing in to Teams again.");
    return;
  }

  // ── Pairing commands ──

  if (text.startsWith("/pair")) {
    const token = text.replace("/pair", "").trim();
    if (!token) {
      await context.send(
        "Usage: /pair <token>\n" +
        "Find the token in the terminal where you ran the client."
      );
      return;
    }
    pairingStore.pair(aadObjectId, token);
    const online = wsHub.isTokenOnline(token);
    await context.send(
      `✓ Paired with client \`${token.slice(0, 8)}...\`.\n` +
      (online
        ? "Client is online. Go ahead and send a message."
        : "Client is not online yet — start it on your computer and messages will start flowing.")
    );
    return;
  }

  if (text === "/unpair") {
    const old = pairingStore.unpair(aadObjectId);
    if (old) {
      await context.send(`✓ Unpaired (was \`${old.slice(0, 8)}...\`).`);
    } else {
      await context.send("You are not paired with any client.");
    }
    return;
  }

  if (text === "/whoami") {
    const token = pairingStore.tokenFor(aadObjectId);
    if (!token) {
      await context.send("You are not paired. Send `/pair <token>` to bind a client.");
    } else {
      const online = wsHub.isTokenOnline(token);
      await context.send(
        `Paired with client \`${token.slice(0, 8)}...\`\n` +
        `Status: ${online ? "online" : "offline"}`
      );
    }
    return;
  }

  // ── Everything below requires a paired, online client ──

  const token = pairingStore.tokenFor(aadObjectId);
  if (!token) {
    await context.send(
      "You are not paired yet. Run the client on your computer, then send:\n" +
      "  /pair <token>"
    );
    return;
  }

  const sendToClient = (message: BotToClient & { id: string }) =>
    wsHub.sendToToken(token, message);

  if (!wsHub.isTokenOnline(token)) {
    await context.send(
      "Your client is offline.\n\n" +
      "Start it on your computer:\n" +
      "  `claude-teams-client`\n\n" +
      "Then send your message again."
    );
    return;
  }

  try {
    if (text === "/reset") {
      const id = wsHub.newRequestId();
      const reply = await sendToClient({ type: "reset", id });
      if (reply.type === "ok") {
        await context.send("Session reset. Next message will start a new Claude conversation.");
      } else if (reply.type === "error") {
        await context.send(`Error: ${reply.message}`);
      }
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
        const id = wsHub.newRequestId();
        const reply = await sendToClient({ type: "get_model", id });
        const current = reply.type === "model_info" ? reply.current : "(unknown)";
        const list = models.map((m, i) =>
          `${i + 1}. ${m.label} — ${m.id}${m.id === current ? " ✓" : ""}`
        ).join("\n");
        await context.send(
          `Current model: ${current}\n\n` +
          `Available models:\n${list}\n\n` +
          `Usage: /model <number or name>`
        );
      } else {
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
        const targetId = matched?.id || modelName;
        const id = wsHub.newRequestId();
        const reply = await sendToClient({ type: "set_model", id, model: targetId });
        if (reply.type === "ok") {
          await context.send(`Model switched to: ${matched?.label || targetId}`);
        } else if (reply.type === "error") {
          await context.send(`Error: ${reply.message}`);
        }
      }
      return;
    }

    if (text === "/compact") {
      await context.send("Compacting conversation...");
      const id = wsHub.newRequestId();
      const reply = await sendToClient({ type: "compact", id });
      await sendToTeams(context, expectReply(reply));
      return;
    }

    if (text === "/status") {
      const id = wsHub.newRequestId();
      const reply = await sendToClient({ type: "status", id });
      if (reply.type !== "status_info") {
        await context.send(`Error: unexpected response ${reply.type}`);
        return;
      }
      const s = reply.data;
      if (!s.active) {
        await context.send("No active Claude session for this conversation.");
      } else {
        await context.send(
          `Session: ${s.sessionId}\n` +
          `Messages: ${s.messageCount}\n` +
          `Cost: $${s.totalCostUsd?.toFixed(4)}\n` +
          `Busy: ${s.busy}\n` +
          `Queue: ${s.queueLength}\n` +
          `Last activity: ${s.lastActivity}`
        );
      }
      return;
    }

    if (text.startsWith("/resume")) {
      const target = text.replace("/resume", "").trim();
      if (!target) {
        const id = wsHub.newRequestId();
        const reply = await sendToClient({ type: "list_sessions", id });
        if (reply.type !== "session_list") {
          await context.send(`Error: unexpected response`);
          return;
        }
        if (reply.items.length === 0) {
          await context.send("No Claude Code sessions found.");
        } else {
          const lines = reply.items.map((s, i) =>
            `${i + 1}. \`${s.id}\` — ${s.date} — ${s.messageCount} msgs${s.preview ? ` — ${s.preview}` : ""}`
          );
          await context.send(
            "Local Claude Code sessions:\n" + lines.join("\n") +
            "\n\nUsage: /resume <number or session_id>"
          );
        }
      } else {
        let sessionId = target;
        const num = parseInt(target);
        if (num >= 1) {
          const listId = wsHub.newRequestId();
          const listReply = await sendToClient({ type: "list_sessions", id: listId });
          if (listReply.type === "session_list" && num <= listReply.items.length) {
            sessionId = listReply.items[num - 1].id;
          }
        }
        const id = wsHub.newRequestId();
        const reply = await sendToClient({ type: "bind_session", id, sessionId });
        if (reply.type === "ok") {
          await context.send(`Resumed session \`${sessionId}\`\nYour messages now continue this Claude conversation.`);
        } else if (reply.type === "error") {
          await context.send(`Error: ${reply.message}`);
        }
      }
      return;
    }

    // Forward to Claude via client
    await context.send("Thinking...");
    logToFile("Claude →", `[${aadObjectId.slice(0, 8)}] ${text.slice(0, 200)}`);
    const id = wsHub.newRequestId();
    const reply = await sendToClient({ type: "user_message", id, text });
    const replyText = expectReply(reply);
    logToFile("Claude ←", `Reply: ${replyText.slice(0, 200)}`);
    await sendToTeams(context, replyText);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logToFile("Bot ERROR", errMsg);
    if (errMsg.includes("did not respond within")) {
      await context.send(
        "Your client did not respond in time.\n" +
        "Check that `claude-teams-client` is still running on your computer."
      );
    } else if (errMsg.includes("offline")) {
      await context.send(errMsg);
    } else {
      await context.send(`Something went wrong: ${errMsg}`);
    }
  }
});

export { pairingStore };
export default app;
