// Install the packed client tarball into a temp dir, spawn it, verify E2E.
import { spawn, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { WsHub } from "../ws-hub";

const WS_PORT = 3987;
const TOKEN = "pack-smoke";

async function main() {
  const root = path.resolve(__dirname, "..");
  const tarballs = fs
    .readdirSync(path.join(root, "packages", "client"))
    .filter((f) => f.startsWith("claude-teams-client-") && f.endsWith(".tgz"));
  if (tarballs.length === 0) {
    console.error("[pack-smoke] no tarball found. Run `npm pack` in packages/client first.");
    process.exit(1);
  }
  const tarball = path.join(root, "packages", "client", tarballs[0]);
  console.log(`[pack-smoke] using tarball: ${tarball}`);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-teams-client-test-"));
  console.log(`[pack-smoke] temp dir: ${tempDir}`);

  try {
    // Install tarball into temp dir
    console.log("[pack-smoke] npm install <tarball>...");
    execSync(`npm init -y`, { cwd: tempDir, stdio: "ignore" });
    execSync(`npm install "${tarball}"`, { cwd: tempDir, stdio: "inherit" });
    const binPath = path.join(tempDir, "node_modules", ".bin", process.platform === "win32" ? "claude-teams-client.cmd" : "claude-teams-client");
    if (!fs.existsSync(binPath)) {
      console.error(`[pack-smoke] bin not found at ${binPath}`);
      process.exit(1);
    }
    console.log(`[pack-smoke] bin installed: ${binPath}`);

    // Start bot-side hub
    const hub = new WsHub();
    hub.start(WS_PORT);

    // Run the installed CLI's `status` command first to verify subcommand works
    console.log("[pack-smoke] running `claude-teams-client status`...");
    const statusOut = execSync(`"${binPath}" status`, { encoding: "utf8" });
    console.log("[pack-smoke] status output:\n" + statusOut);

    // Start the daemon
    console.log("[pack-smoke] starting client daemon...");
    const child = spawn(binPath, [], {
      env: {
        ...process.env,
        BOT_WS_URL: `ws://localhost:${WS_PORT}`,
        CLIENT_TOKEN: TOKEN,
      },
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    await new Promise<void>((resolve, reject) => {
      const t0 = Date.now();
      const interval = setInterval(() => {
        if (hub.isTokenOnline(TOKEN)) {
          clearInterval(interval);
          resolve();
        } else if (Date.now() - t0 > 15000) {
          clearInterval(interval);
          reject(new Error("client did not connect within 15s"));
        }
      }, 200);
    });
    console.log("[pack-smoke] client connected");

    try {
      const id = hub.newRequestId();
      const reply = await hub.sendToToken(TOKEN, {
        type: "user_message",
        id,
        text: "Reply with exactly the word PACK_OK and nothing else.",
      });
      const replyText = reply.type === "reply" ? reply.text : `[${reply.type}]`;
      console.log("[pack-smoke] reply:", replyText.slice(0, 80));
      if (replyText.includes("PACK_OK")) {
        console.log("[pack-smoke] ✓ PASS — packed client works end-to-end");
      } else {
        console.log("[pack-smoke] ✗ FAIL — unexpected reply");
        process.exitCode = 1;
      }
    } finally {
      child.kill();
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log(`[pack-smoke] cleaned up ${tempDir}`);
    } catch {}
    setTimeout(() => process.exit(process.exitCode || 0), 500);
  }
}

main().catch((err) => {
  console.error("[pack-smoke] error:", err);
  process.exit(1);
});
