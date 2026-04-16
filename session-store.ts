import * as fs from "fs";
import * as path from "path";

const DATA_DIR = process.env.TEAMBOT_DATA_DIR || __dirname;
const STATE_FILE = path.join(DATA_DIR, "bot-state.json");
const INBOX_DIR = path.join(DATA_DIR, "inbox");

interface ThreadBinding {
  sessionId: string;
  channelConversationId: string;
  threadActivityId: string;
  createdAt: string;
}

interface BotState {
  channelConversationId: string | null;
  connectorUrl: string | null;
  threads: ThreadBinding[];
  claudeSessions: Record<string, string>; // conversationId → claude session ID
  terminalClaudeSessions: Record<string, string>; // terminal sessionId (e.g. "task-1") → claude session ID
}

export class SessionStore {
  private channelConversationId: string | null = null;
  private connectorUrl: string | null = null;
  private threads: Map<string, ThreadBinding> = new Map();
  private claudeSessions: Map<string, string> = new Map();
  private terminalClaudeSessions: Map<string, string> = new Map();

  constructor() {
    this.load();
    if (!fs.existsSync(INBOX_DIR)) {
      fs.mkdirSync(INBOX_DIR, { recursive: true });
    }
  }

  // --- Channel / Connector ---

  setChannelConversationId(id: string): void {
    this.channelConversationId = id;
    this.save();
  }

  getChannelConversationId(): string | null {
    return this.channelConversationId;
  }

  setConnectorUrl(url: string): void {
    this.connectorUrl = url;
    this.save();
  }

  getConnectorUrl(): string | null {
    return this.connectorUrl;
  }

  // --- Claude Session persistence ---

  setClaudeSessionId(conversationId: string, sessionId: string): void {
    this.claudeSessions.set(conversationId, sessionId);
    this.save();
  }

  getClaudeSessionId(conversationId: string): string | null {
    return this.claudeSessions.get(conversationId) ?? null;
  }

  removeClaudeSession(conversationId: string): void {
    this.claudeSessions.delete(conversationId);
    this.save();
  }

  // --- Terminal Claude Session ID (for /bind) ---

  setTerminalClaudeSessionId(terminalSessionId: string, claudeSessionId: string): void {
    this.terminalClaudeSessions.set(terminalSessionId, claudeSessionId);
    this.save();
  }

  getTerminalClaudeSessionId(terminalSessionId: string): string | null {
    return this.terminalClaudeSessions.get(terminalSessionId) ?? null;
  }

  // --- Thread bindings ---

  registerThread(sessionId: string, channelConversationId: string, threadActivityId: string): void {
    this.threads.set(sessionId, {
      sessionId,
      channelConversationId,
      threadActivityId,
      createdAt: new Date().toISOString(),
    });
    this.save();
  }

  getThread(sessionId: string): ThreadBinding | null {
    return this.threads.get(sessionId) ?? null;
  }

  getAllThreads(): ThreadBinding[] {
    return Array.from(this.threads.values());
  }

  removeThread(sessionId: string): void {
    this.threads.delete(sessionId);
    this.save();
  }

  // --- Inbox (Teams → Terminal) ---

  writeToInbox(sessionId: string, from: string, text: string): void {
    const file = path.join(INBOX_DIR, `${sessionId}.jsonl`);
    const entry = JSON.stringify({
      from,
      text,
      timestamp: new Date().toISOString(),
    });
    fs.appendFileSync(file, entry + "\n");
  }

  readInbox(sessionId: string): Array<{ from: string; text: string; timestamp: string }> {
    const file = path.join(INBOX_DIR, `${sessionId}.jsonl`);
    if (!fs.existsSync(file)) return [];

    const content = fs.readFileSync(file, "utf8").trim();
    if (!content) return [];

    fs.writeFileSync(file, "");
    return content.split("\n").map((line) => JSON.parse(line));
  }

  // --- Persistence ---

  private load(): void {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const data: BotState = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
        this.channelConversationId = data.channelConversationId;
        this.connectorUrl = data.connectorUrl ?? null;
        for (const t of data.threads || []) {
          this.threads.set(t.sessionId, t);
        }
        if (data.claudeSessions) {
          for (const [k, v] of Object.entries(data.claudeSessions)) {
            this.claudeSessions.set(k, v);
          }
        }
        if (data.terminalClaudeSessions) {
          for (const [k, v] of Object.entries(data.terminalClaudeSessions)) {
            this.terminalClaudeSessions.set(k, v);
          }
        }
      }
    } catch {
      // Start fresh
    }
  }

  private save(): void {
    const claudeSessions: Record<string, string> = {};
    for (const [k, v] of this.claudeSessions.entries()) {
      claudeSessions[k] = v;
    }
    const terminalClaudeSessions: Record<string, string> = {};
    for (const [k, v] of this.terminalClaudeSessions.entries()) {
      terminalClaudeSessions[k] = v;
    }
    const state: BotState = {
      channelConversationId: this.channelConversationId,
      connectorUrl: this.connectorUrl,
      threads: Array.from(this.threads.values()),
      claudeSessions,
      terminalClaudeSessions,
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }
}
