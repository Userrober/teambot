import * as fs from "fs";
import * as path from "path";

const STATE_FILE = path.join(__dirname, "pairings.json");

interface PairingsFile {
  byAad: Record<string, string>;   // aadObjectId → token
  byToken: Record<string, string>; // token → aadObjectId
}

export class PairingStore {
  private byAad: Map<string, string> = new Map();
  private byToken: Map<string, string> = new Map();

  constructor() {
    this.load();
  }

  pair(aadObjectId: string, token: string): void {
    // Remove any stale bindings for either side so the new pair is unique.
    const prevToken = this.byAad.get(aadObjectId);
    if (prevToken && prevToken !== token) {
      this.byToken.delete(prevToken);
    }
    const prevAad = this.byToken.get(token);
    if (prevAad && prevAad !== aadObjectId) {
      this.byAad.delete(prevAad);
    }
    this.byAad.set(aadObjectId, token);
    this.byToken.set(token, aadObjectId);
    this.save();
  }

  unpair(aadObjectId: string): string | null {
    const token = this.byAad.get(aadObjectId);
    if (!token) return null;
    this.byAad.delete(aadObjectId);
    this.byToken.delete(token);
    this.save();
    return token;
  }

  tokenFor(aadObjectId: string): string | null {
    return this.byAad.get(aadObjectId) ?? null;
  }

  aadFor(token: string): string | null {
    return this.byToken.get(token) ?? null;
  }

  private load(): void {
    try {
      if (!fs.existsSync(STATE_FILE)) return;
      const data: PairingsFile = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      for (const [k, v] of Object.entries(data.byAad || {})) this.byAad.set(k, v);
      for (const [k, v] of Object.entries(data.byToken || {})) this.byToken.set(k, v);
    } catch {}
  }

  private save(): void {
    const byAad: Record<string, string> = {};
    const byToken: Record<string, string> = {};
    for (const [k, v] of this.byAad.entries()) byAad[k] = v;
    for (const [k, v] of this.byToken.entries()) byToken[k] = v;
    fs.writeFileSync(STATE_FILE, JSON.stringify({ byAad, byToken }, null, 2));
  }
}
