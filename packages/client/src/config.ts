import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";

const CONFIG_DIR = path.join(os.homedir(), ".claude-teams-client");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const MIRROR_FILE = path.join(CONFIG_DIR, "mirror-cwds.json");

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

function normalizeCwd(cwd: string): string {
  return path.resolve(cwd).toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "");
}

function readMirrorCwds(): string[] {
  try {
    const raw = fs.readFileSync(MIRROR_FILE, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeMirrorCwds(cwds: string[]): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(MIRROR_FILE, JSON.stringify(cwds, null, 2));
}

export function listMirrorCwds(): string[] {
  return readMirrorCwds();
}

export function addMirrorCwd(cwd: string): { added: boolean; cwd: string } {
  const norm = normalizeCwd(cwd);
  const list = readMirrorCwds();
  if (list.includes(norm)) return { added: false, cwd: norm };
  list.push(norm);
  writeMirrorCwds(list);
  return { added: true, cwd: norm };
}

export function removeMirrorCwd(cwd: string): { removed: boolean; cwd: string } {
  const norm = normalizeCwd(cwd);
  const list = readMirrorCwds();
  const idx = list.indexOf(norm);
  if (idx === -1) return { removed: false, cwd: norm };
  list.splice(idx, 1);
  writeMirrorCwds(list);
  return { removed: true, cwd: norm };
}

export function isMirrorCwd(cwd: string): boolean {
  const norm = normalizeCwd(cwd);
  return readMirrorCwds().some((entry) => norm === entry || norm.startsWith(entry + "/"));
}

export function mirrorCwdsPath(): string {
  return MIRROR_FILE;
}
