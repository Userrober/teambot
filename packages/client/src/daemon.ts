import WebSocket from "ws";
import * as http from "http";
import { ClaudeCodeBridge } from "./claude-bridge";
import { isMirrorCwd } from "./config";
import type { BotToClient, ClientToBot } from "./protocol";

const LOCAL_CONV_ID = "client-local";
const CLIENT_VERSION = "0.6.0";
const DEFAULT_MIRROR_PORT = 47291;

interface DaemonOptions {
  botUrl: string;
  token: string;
}

export function runDaemon(opts: DaemonOptions): void {
  const bridge = new ClaudeCodeBridge({
    cliPath: process.env.CLAUDE_CLI_PATH || (process.platform === "win32" ? "claude.cmd" : "claude"),
    model: process.env.CLAUDE_MODEL || "claude-opus-4-6-20250514",
    workingDirectory: process.env.CLAUDE_WORKING_DIR || process.cwd(),
    timeoutMs: parseInt(process.env.CLAUDE_TIMEOUT_MS || "300000"),
    maxBudgetUsd: parseFloat(process.env.CLAUDE_MAX_BUDGET_USD || "0"),
    bare: process.env.CLAUDE_BARE === "true",
    permissionMode: process.env.CLAUDE_PERMISSION_MODE || "auto",
    systemPrompt: process.env.CLAUDE_SYSTEM_PROMPT,
  });

  let ws: WebSocket | null = null;
  let reconnectDelay = 1000;
  let pingInterval: NodeJS.Timeout | null = null;
  let failureStreak = 0;
  let lastFailureKey = "";
  let lastErrorMsg = "";

  const connect = (): void => {
    if (failureStreak === 0) {
      console.log(`[client] connecting to ${opts.botUrl}...`);
    }
    ws = new WebSocket(opts.botUrl);

    ws.on("open", () => {
      if (failureStreak > 0) {
        console.log(`[client] reconnected after ${failureStreak} attempt(s)`);
      }
      failureStreak = 0;
      lastFailureKey = "";
      lastErrorMsg = "";
      console.log(`[client] connected, sending hello (token=${opts.token.slice(0, 8)}...)`);
      reconnectDelay = 1000;
      send({ type: "hello", token: opts.token, clientVersion: CLIENT_VERSION });
      pingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.ping();
          send({ type: "pong", id: "keepalive" });
        }
      }, 20000);
    });

    ws.on("message", async (raw) => {
      let msg: BotToClient;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        console.warn("[client] malformed message");
        return;
      }
      await handleMessage(msg);
    });

    ws.on("close", (code, reason) => {
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
      const key = `close:${code}:${reason?.toString() || ""}`;
      if (key !== lastFailureKey) {
        const reasonStr = reason?.toString() || "none";
        console.log(`[client] disconnected (code=${code}, reason=${reasonStr}), retrying...`);
        lastFailureKey = key;
      }
      failureStreak++;
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    });

    ws.on("error", (err) => {
      if (err.message !== lastErrorMsg) {
        console.error("[client] socket error:", err.message);
        lastErrorMsg = err.message;
      }
    });
  };

  const send = (msg: ClientToBot): void => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const handleMessage = async (msg: BotToClient): Promise<void> => {
    console.log(`[client] ← ${msg.type}`);
    try {
      switch (msg.type) {
        case "user_message": {
          const reply = await bridge.sendMessage(LOCAL_CONV_ID, msg.text);
          send({ type: "reply", id: msg.id, text: reply });
          break;
        }
        case "list_sessions": {
          const items = bridge.listLocalSessions();
          send({ type: "session_list", id: msg.id, items });
          break;
        }
        case "bind_session": {
          bridge.bindSession(LOCAL_CONV_ID, msg.sessionId);
          send({ type: "ok", id: msg.id });
          break;
        }
        case "reset": {
          bridge.resetSession(LOCAL_CONV_ID);
          send({ type: "ok", id: msg.id });
          break;
        }
        case "set_model": {
          bridge.setModel(msg.model);
          send({ type: "ok", id: msg.id });
          break;
        }
        case "get_model": {
          send({ type: "model_info", id: msg.id, current: bridge.getModel() });
          break;
        }
        case "compact": {
          const reply = await bridge.sendMessage(LOCAL_CONV_ID, "/compact");
          send({ type: "reply", id: msg.id, text: reply });
          break;
        }
        case "status": {
          const s = bridge.getSessionStatus(LOCAL_CONV_ID);
          send({ type: "status_info", id: msg.id, data: s });
          break;
        }
        case "ping": {
          send({ type: "pong", id: msg.id });
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[client] error handling ${msg.type}:`, message);
      if ("id" in msg) {
        send({ type: "error", id: msg.id, message });
      }
    }
  };

  // ── Mirror HTTP server ──
  // Receives push events from Claude Code hooks and forwards to bot via WS.
  const mirrorPort = parseInt(process.env.MIRROR_PORT || String(DEFAULT_MIRROR_PORT));
  const mirrorServer = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/mirror") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const text: unknown = parsed.text;
        const cwd: string | undefined = typeof parsed.cwd === "string" ? parsed.cwd : undefined;
        const sessionId: string | undefined = typeof parsed.sessionId === "string" ? parsed.sessionId : undefined;
        if (typeof text !== "string" || text.length === 0) {
          res.writeHead(400).end("missing text");
          return;
        }
        if (cwd && !isMirrorCwd(cwd)) {
          res.writeHead(200).end("skipped (cwd not whitelisted)");
          return;
        }
        const prefix = sessionId ? `[${sessionId.slice(0, 8)}] ` : "";
        const finalText = prefix + text;
        if (ws && ws.readyState === WebSocket.OPEN) {
          send({ type: "mirror_push", text: finalText });
          res.writeHead(200).end("ok");
        } else {
          res.writeHead(503).end("bot offline");
        }
      } catch {
        res.writeHead(400).end("invalid json");
      }
    });
  });
  mirrorServer.listen(mirrorPort, "127.0.0.1", () => {
    console.log(`[client] mirror endpoint: http://127.0.0.1:${mirrorPort}/mirror`);
  });
  mirrorServer.on("error", (err) => {
    console.error(`[client] mirror server error:`, err.message);
  });

  connect();
}
