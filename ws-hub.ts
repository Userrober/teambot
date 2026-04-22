import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer, IncomingMessage } from "http";
import { randomUUID } from "crypto";
import type { BotToClient, ClientToBot } from "./protocol";

interface ClientConnection {
  socket: WebSocket;
  token: string;
  connectedAt: number;
}

interface PendingRequest {
  resolve: (msg: ClientToBot) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export type MirrorHandler = (token: string, text: string) => void;

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export class WsHub {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ClientConnection> = new Map(); // token → connection
  private pending: Map<string, PendingRequest> = new Map();
  private mirrorHandler: MirrorHandler | null = null;
  private flapStreak: Map<string, number> = new Map(); // token → consecutive flap count

  start(port: number): void {
    this.wss = new WebSocketServer({ port });
    this.wss.on("connection", (socket) => this.handleConnection(socket));
    console.log(`[ws-hub] WebSocket server listening on port ${port}`);
  }

  // Attach WS to an existing HTTP server on a specific path (same port as the bot).
  attach(server: HttpServer, path: string): void {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (socket) => this.handleConnection(socket));
    server.on("upgrade", (req: IncomingMessage, socket, head) => {
      const url = req.url || "";
      const reqPath = url.split("?")[0];
      if (reqPath !== path) return;
      this.wss!.handleUpgrade(req, socket as any, head, (ws) => {
        this.wss!.emit("connection", ws, req);
      });
    });
    console.log(`[ws-hub] WebSocket attached at path ${path}`);
  }

  setMirrorHandler(handler: MirrorHandler): void {
    this.mirrorHandler = handler;
  }

  isTokenOnline(token: string): boolean {
    return this.clients.has(token);
  }

  async sendToToken(token: string, message: BotToClient & { id: string }): Promise<ClientToBot> {
    const client = this.clients.get(token);
    if (!client) {
      throw new Error(
        "Your client is offline. Start the client on your machine:\n" +
        "  npm install -g claude-teams-client && claude-teams-client"
      );
    }
    return new Promise<ClientToBot>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.id);
        reject(new Error(`Client did not respond within ${REQUEST_TIMEOUT_MS / 1000}s`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(message.id, { resolve, reject, timer });
      try {
        client.socket.send(JSON.stringify(message));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(message.id);
        reject(err as Error);
      }
    });
  }

  newRequestId(): string {
    return randomUUID();
  }

  private handleConnection(socket: WebSocket): void {
    let token: string | null = null;

    socket.on("message", (raw) => {
      let msg: ClientToBot;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        console.warn("[ws-hub] malformed message");
        return;
      }

      if (msg.type === "hello") {
        token = msg.token;
        // Kick any previous connection for this token
        const prev = this.clients.get(token);
        if (prev && prev.socket !== socket) {
          try {
            prev.socket.close(4000, "replaced by new connection");
          } catch {}
          console.log(`[ws-hub] kicked stale connection for token=${token.slice(0, 8)}...`);
        }
        this.clients.set(token, { socket, token, connectedAt: Date.now() });
        const flaps = this.flapStreak.get(token) || 0;
        if (flaps === 0) {
          console.log(`[ws-hub] client connected, token=${token.slice(0, 8)}..., version=${msg.clientVersion}`);
        } else if (flaps >= 3 && flaps % 10 === 0) {
          console.log(`[ws-hub] token=${token.slice(0, 8)}... still flapping (${flaps} cycles)`);
        }
        return;
      }

      if (msg.type === "mirror_push") {
        if (token) this.mirrorHandler?.(token, msg.text);
        return;
      }

      if ("id" in msg) {
        const p = this.pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          p.resolve(msg);
        }
      }
    });

    socket.on("close", () => {
      if (token) {
        const current = this.clients.get(token);
        if (current && current.socket === socket) {
          this.clients.delete(token);
          const lifetime = Date.now() - current.connectedAt;
          const flaps = (this.flapStreak.get(token) || 0) + 1;
          if (lifetime < 30000) {
            this.flapStreak.set(token, flaps);
            if (flaps === 1) {
              console.log(`[ws-hub] client disconnected, token=${token.slice(0, 8)}...`);
            }
          } else {
            this.flapStreak.delete(token);
            console.log(`[ws-hub] client disconnected, token=${token.slice(0, 8)}... (was up ${Math.round(lifetime / 1000)}s)`);
          }
        }
      }
    });

    socket.on("error", (err) => {
      console.error("[ws-hub] socket error:", err.message);
    });
  }
}
