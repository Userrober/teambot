import * as fs from "fs";
import * as path from "path";
import { Redis } from "@upstash/redis";

const STATE_FILE = path.join(__dirname, "pairings.json");
const REDIS_AAD_KEY = "teambot:pairings:byAad";
const REDIS_TOKEN_KEY = "teambot:pairings:byToken";
const REDIS_CONV_KEY = "teambot:conversations:byAad";

interface PairingsFile {
  byAad: Record<string, string>;
  byToken: Record<string, string>;
  conversations?: Record<string, string>;
}

export class PairingStore {
  private byAad: Map<string, string> = new Map();
  private byToken: Map<string, string> = new Map();
  private conversations: Map<string, string> = new Map();
  private redis: Redis | null = null;
  private ready: Promise<void>;

  constructor() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) {
      this.redis = new Redis({ url, token });
      this.ready = this.loadFromRedis();
    } else {
      console.log("[pairing-store] UPSTASH_REDIS_REST_* not set, falling back to local file");
      this.loadFromFile();
      this.ready = Promise.resolve();
    }
  }

  async waitReady(): Promise<void> {
    return this.ready;
  }

  pair(aadObjectId: string, token: string): void {
    const prevToken = this.byAad.get(aadObjectId);
    if (prevToken && prevToken !== token) {
      this.byToken.delete(prevToken);
      this.redisDel(REDIS_TOKEN_KEY, prevToken);
    }
    const prevAad = this.byToken.get(token);
    if (prevAad && prevAad !== aadObjectId) {
      this.byAad.delete(prevAad);
      this.redisDel(REDIS_AAD_KEY, prevAad);
    }
    this.byAad.set(aadObjectId, token);
    this.byToken.set(token, aadObjectId);
    this.persist(aadObjectId, token);
  }

  unpair(aadObjectId: string): string | null {
    const token = this.byAad.get(aadObjectId);
    if (!token) return null;
    this.byAad.delete(aadObjectId);
    this.byToken.delete(token);
    if (this.redis) {
      this.redisDel(REDIS_AAD_KEY, aadObjectId);
      this.redisDel(REDIS_TOKEN_KEY, token);
    } else {
      this.saveToFile();
    }
    return token;
  }

  tokenFor(aadObjectId: string): string | null {
    return this.byAad.get(aadObjectId) ?? null;
  }

  aadFor(token: string): string | null {
    return this.byToken.get(token) ?? null;
  }

  setConversation(aadObjectId: string, conversationId: string): void {
    if (this.conversations.get(aadObjectId) === conversationId) return;
    this.conversations.set(aadObjectId, conversationId);
    if (this.redis) {
      this.redis.hset(REDIS_CONV_KEY, { [aadObjectId]: conversationId })
        .catch((e) => console.error("[pairing-store] Redis hset conv failed:", e?.message || e));
    } else {
      this.saveToFile();
    }
  }

  conversationFor(aadObjectId: string): string | null {
    return this.conversations.get(aadObjectId) ?? null;
  }

  private async loadFromRedis(): Promise<void> {
    try {
      const [byAad, byToken, conversations] = await Promise.all([
        this.redis!.hgetall<Record<string, string>>(REDIS_AAD_KEY),
        this.redis!.hgetall<Record<string, string>>(REDIS_TOKEN_KEY),
        this.redis!.hgetall<Record<string, string>>(REDIS_CONV_KEY),
      ]);
      if (byAad) for (const [k, v] of Object.entries(byAad)) this.byAad.set(k, v);
      if (byToken) for (const [k, v] of Object.entries(byToken)) this.byToken.set(k, v);
      if (conversations) for (const [k, v] of Object.entries(conversations)) this.conversations.set(k, v);
      console.log(`[pairing-store] loaded ${this.byAad.size} pairing(s), ${this.conversations.size} conversation(s) from Redis`);
    } catch (err) {
      console.error("[pairing-store] Redis load failed:", err instanceof Error ? err.message : err);
    }
  }

  private loadFromFile(): void {
    try {
      if (!fs.existsSync(STATE_FILE)) return;
      const data: PairingsFile = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      for (const [k, v] of Object.entries(data.byAad || {})) this.byAad.set(k, v);
      for (const [k, v] of Object.entries(data.byToken || {})) this.byToken.set(k, v);
      for (const [k, v] of Object.entries(data.conversations || {})) this.conversations.set(k, v);
    } catch {}
  }

  private saveToFile(): void {
    const byAad: Record<string, string> = {};
    const byToken: Record<string, string> = {};
    const conversations: Record<string, string> = {};
    for (const [k, v] of this.byAad.entries()) byAad[k] = v;
    for (const [k, v] of this.byToken.entries()) byToken[k] = v;
    for (const [k, v] of this.conversations.entries()) conversations[k] = v;
    fs.writeFileSync(STATE_FILE, JSON.stringify({ byAad, byToken, conversations }, null, 2));
  }

  private persist(aadObjectId: string, token: string): void {
    if (this.redis) {
      this.redis.hset(REDIS_AAD_KEY, { [aadObjectId]: token })
        .catch((e) => console.error("[pairing-store] Redis hset byAad failed:", e?.message || e));
      this.redis.hset(REDIS_TOKEN_KEY, { [token]: aadObjectId })
        .catch((e) => console.error("[pairing-store] Redis hset byToken failed:", e?.message || e));
    } else {
      this.saveToFile();
    }
  }

  private redisDel(key: string, field: string): void {
    if (!this.redis) return;
    this.redis.hdel(key, field)
      .catch((e) => console.error("[pairing-store] Redis hdel failed:", e?.message || e));
  }
}
