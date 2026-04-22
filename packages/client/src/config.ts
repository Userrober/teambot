import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";

const CONFIG_DIR = path.join(os.homedir(), ".claude-teams-client");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface ClientConfig {
  token: string;
  botUrl?: string;
  createdAt: string;
}

function readRaw(): Partial<ClientConfig> | null {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Partial<ClientConfig>;
  } catch {
    return null;
  }
}

function writeRaw(cfg: ClientConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

export function loadOrCreateConfig(): ClientConfig {
  const existing = readRaw();
  if (existing && typeof existing.token === "string" && existing.token) {
    return {
      token: existing.token,
      botUrl: existing.botUrl,
      createdAt: existing.createdAt ?? new Date().toISOString(),
    };
  }
  const cfg: ClientConfig = {
    token: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  writeRaw(cfg);
  return cfg;
}

export function updateConfig(patch: Partial<ClientConfig>): ClientConfig {
  const current = loadOrCreateConfig();
  const next: ClientConfig = { ...current, ...patch };
  writeRaw(next);
  return next;
}

export function resetToken(): ClientConfig {
  const current = readRaw() ?? {};
  const next: ClientConfig = {
    token: randomUUID(),
    botUrl: current.botUrl,
    createdAt: new Date().toISOString(),
  };
  writeRaw(next);
  return next;
}

export function configPath(): string {
  return CONFIG_FILE;
}
