import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";
import type {
  ClaudeResult,
  ClaudeBridgeConfig,
  ConversationSession,
} from "./claude-types";
import type { SessionStore } from "./session-store";

const MAX_QUEUE_DEPTH = 5;

export class ClaudeCodeBridge {
  private config: ClaudeBridgeConfig;
  private sessions: Map<string, ConversationSession> = new Map();
  private sessionStore: SessionStore | null;

  constructor(config: ClaudeBridgeConfig, sessionStore?: SessionStore) {
    this.config = config;
    this.sessionStore = sessionStore ?? null;
  }

  getModel(): string {
    return this.config.model;
  }

  setModel(model: string): void {
    this.config.model = model;
  }

  async sendMessage(conversationId: string, text: string): Promise<string> {
    const session = this.getOrCreateSession(conversationId);

    if (session.busy) {
      if (session.queue.length >= MAX_QUEUE_DEPTH) {
        throw new Error(
          "Too many pending messages. Please wait for the current request to finish."
        );
      }
      return new Promise<string>((resolve, reject) => {
        session.queue.push({ text, resolve, reject });
      });
    }

    return this.processMessage(session, text);
  }

  resetSession(conversationId: string): void {
    this.sessions.delete(conversationId);
    this.sessionStore?.removeClaudeSession(conversationId);
  }

  bindSession(conversationId: string, claudeSessionId: string): void {
    let session = this.sessions.get(conversationId);
    if (session) {
      session.claudeSessionId = claudeSessionId;
    } else {
      session = {
        conversationId,
        claudeSessionId,
        totalCostUsd: 0,
        messageCount: 0,
        busy: false,
        queue: [],
        lastActivity: Date.now(),
      };
      this.sessions.set(conversationId, session);
    }
    this.sessionStore?.setClaudeSessionId(conversationId, claudeSessionId);
  }

  getSessionStatus(conversationId: string) {
    const session = this.sessions.get(conversationId);
    if (!session) {
      return { active: false };
    }
    return {
      active: true,
      sessionId: session.claudeSessionId,
      messageCount: session.messageCount,
      totalCostUsd: session.totalCostUsd,
      busy: session.busy,
      queueLength: session.queue.length,
      lastActivity: new Date(session.lastActivity).toISOString(),
    };
  }

  listLocalSessions(): Array<{ id: string; date: string; messageCount: number; preview: string }> {
    // Find Claude Code sessions stored as JSONL files
    const home = os.homedir();
    const projectsDir = path.join(home, ".claude", "projects");

    if (!fs.existsSync(projectsDir)) return [];

    // Find the project directory by matching path segments
    // Claude Code encodes paths like C:\Users\foo\bar -> C--Users-foo-bar
    const wdParts = this.config.workingDirectory
      .split(path.sep)
      .filter(Boolean)
      .map(p => p.replace(":", ""));
    const sessionsDir = fs.readdirSync(projectsDir)
      .map(d => path.join(projectsDir, d))
      .filter(d => fs.statSync(d).isDirectory())
      .find(d => {
        const dirName = path.basename(d);
        // Check if all path segments appear in order in the directory name
        return wdParts.every(part => dirName.includes(part));
      });

    if (!sessionsDir) return [];

    const files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith(".jsonl") && !f.includes("subagents"))
      .map(f => {
        const filePath = path.join(sessionsDir, f);
        const id = f.replace(".jsonl", "");
        const stat = fs.statSync(filePath);
        const date = stat.mtime.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

        let messageCount = 0;
        let preview = "";
        try {
          const content = fs.readFileSync(filePath, "utf8");
          for (const line of content.split("\n")) {
            if (!line.trim()) continue;
            try {
              const d = JSON.parse(line);
              if (d.type === "user" && !d.isMeta) {
                messageCount++;
                if (!preview) {
                  const msg = d.message?.content;
                  if (typeof msg === "string") {
                    preview = msg.slice(0, 40);
                  } else if (Array.isArray(msg)) {
                    for (const c of msg) {
                      if (c?.type === "text" && c.text) {
                        preview = c.text.slice(0, 40);
                        break;
                      }
                    }
                  }
                }
              }
            } catch {}
          }
        } catch {}

        return { id, date, messageCount, preview, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 10)
      .map(({ mtime, ...rest }) => rest);

    return files;
  }

  private getOrCreateSession(conversationId: string): ConversationSession {
    let session = this.sessions.get(conversationId);
    if (!session) {
      // Try to restore persisted Claude session ID
      const persistedId = this.sessionStore?.getClaudeSessionId(conversationId) ?? null;
      session = {
        conversationId,
        claudeSessionId: persistedId,
        totalCostUsd: 0,
        messageCount: 0,
        busy: false,
        queue: [],
        lastActivity: Date.now(),
      };
      this.sessions.set(conversationId, session);
    }
    return session;
  }

  private async processMessage(
    session: ConversationSession,
    text: string
  ): Promise<string> {
    session.busy = true;
    try {
      const result = await this.invokeClaude(session, text);
      console.log("[Claude CLI raw]", JSON.stringify(result).slice(0, 1000));
      session.claudeSessionId = result.session_id;
      session.totalCostUsd += result.total_cost_usd;
      session.messageCount++;
      session.lastActivity = Date.now();

      // Persist session ID
      this.sessionStore?.setClaudeSessionId(session.conversationId, result.session_id);

      if (result.is_error) {
        throw new Error(result.result || `Claude error (${result.subtype}, stop: ${result.stop_reason})`);
      }
      return result.result;
    } catch (error) {
      // If resume failed, retry without resume
      if (session.claudeSessionId && this.isResumeError(error)) {
        session.claudeSessionId = null;
        this.sessionStore?.removeClaudeSession(session.conversationId);
        try {
          const result = await this.invokeClaude(session, text);
          session.claudeSessionId = result.session_id;
          session.totalCostUsd += result.total_cost_usd;
          session.messageCount++;
          session.lastActivity = Date.now();
          this.sessionStore?.setClaudeSessionId(session.conversationId, result.session_id);
          if (result.is_error) {
            throw new Error(result.result || "Claude CLI returned an error with no details");
          }
          return result.result;
        } catch (retryError) {
          throw retryError;
        }
      }
      throw error;
    } finally {
      session.busy = false;
      this.drainQueue(session);
    }
  }

  private async invokeClaude(
    session: ConversationSession,
    text: string
  ): Promise<ClaudeResult> {
    const args: string[] = ["-p", "--output-format", "json"];

    if (session.claudeSessionId) {
      args.push("--resume", session.claudeSessionId);
    }
    if (this.config.model) {
      args.push("--model", this.config.model);
    }
    if (this.config.bare) {
      args.push("--bare");
    }
    if (this.config.maxBudgetUsd) {
      args.push("--max-budget-usd", String(this.config.maxBudgetUsd));
    }
    if (this.config.permissionMode) {
      args.push("--permission-mode", this.config.permissionMode);
    }
    if (this.config.systemPrompt) {
      args.push("--append-system-prompt", this.config.systemPrompt);
    }
    if (this.config.allowedTools?.length) {
      args.push("--allowed-tools", ...this.config.allowedTools);
    }

    const { stdout, stderr } = await new Promise<{
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn(this.config.cliPath, args, {
        cwd: this.config.workingDirectory,
        shell: true,
        ...(this.config.timeoutMs > 0 ? { timeout: this.config.timeoutMs } : {}),
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

      child.on("error", (err) => reject(err));
      child.on("close", (code) => {
        if (stdout) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Claude CLI exited (code ${code}) with no output. stderr: ${stderr.slice(0, 500)}`));
        }
      });

      // Send user message via stdin
      child.stdin.write(text);
      child.stdin.end();
    });

    try {
      const parsed = JSON.parse(stdout) as ClaudeResult;
      if (!parsed.result && parsed.is_error && stderr) {
        parsed.result = stderr.slice(0, 500);
      }
      return parsed;
    } catch {
      throw new Error(
        `Failed to parse Claude CLI output.\nstdout: ${stdout.slice(0, 500)}\nstderr: ${stderr.slice(0, 500)}`
      );
    }
  }

  private isResumeError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes("session") ||
        msg.includes("resume") ||
        msg.includes("not found")
      );
    }
    return false;
  }

  private drainQueue(session: ConversationSession): void {
    if (session.queue.length === 0) return;
    const next = session.queue.shift()!;
    this.processMessage(session, next.text).then(next.resolve, next.reject);
  }
}
