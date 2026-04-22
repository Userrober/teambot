// Smoke test: start ws hub, start a client, send a user_message, expect a reply.
// Run with: node -r ts-node/register scripts/ws-smoke.ts

import { spawn } from "child_process";
import { WsHub } from "../ws-hub";

const WS_PORT = 3989;
const TOKEN = "smoke";

async function main() {
  const hub = new WsHub();
  hub.start(WS_PORT);

  console.log("[smoke] starting client subprocess...");
  const child = spawn(
    process.execPath,
    ["-r", "ts-node/register", "packages/client/src/cli.ts"],
    {
      env: {
        ...process.env,
        BOT_WS_URL: `ws://localhost:${WS_PORT}`,
        CLIENT_TOKEN: TOKEN,
      },
      stdio: "inherit",
    }
  );

  await new Promise<void>((resolve, reject) => {
    const t0 = Date.now();
    const interval = setInterval(() => {
      if (hub.isTokenOnline(TOKEN)) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - t0 > 10000) {
        clearInterval(interval);
        reject(new Error("Client did not connect within 10s"));
      }
    }, 200);
  });
  console.log("[smoke] client connected, sending test message");

  try {
    const id = hub.newRequestId();
    const reply = await hub.sendToToken(TOKEN, {
      type: "user_message",
      id,
      text: "Reply with exactly the word PONG and nothing else.",
    });
    console.log("[smoke] got reply:", JSON.stringify(reply).slice(0, 500));
    if (reply.type === "reply") {
      console.log("[smoke] ✓ PASS — text:", reply.text.slice(0, 200));
    } else {
      console.log("[smoke] ✗ FAIL — unexpected reply type:", reply.type);
    }
  } catch (err) {
    console.error("[smoke] ✗ FAIL —", err);
  } finally {
    child.kill();
    process.exit(0);
  }
}

main();
