// Multi-user isolation smoke test.
// - Starts hub
// - Spawns two clients with different tokens
// - Sends different prompts to each via sendToToken
// - Confirms each reply came from the right client (by Claude's response content)
//   and that sending to one token doesn't leak to the other.

import { spawn } from "child_process";
import { WsHub } from "../ws-hub";

const WS_PORT = 3988;
const TOKEN_A = "smoke-user-a";
const TOKEN_B = "smoke-user-b";

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const t0 = Date.now();
  while (!predicate()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function main() {
  const hub = new WsHub();
  hub.start(WS_PORT);

  console.log("[multi-smoke] starting two clients...");
  const childA = spawn(process.execPath, ["-r", "ts-node/register", "packages/client/src/cli.ts"], {
    env: { ...process.env, BOT_WS_URL: `ws://localhost:${WS_PORT}`, CLIENT_TOKEN: TOKEN_A },
    stdio: "inherit",
  });
  const childB = spawn(process.execPath, ["-r", "ts-node/register", "packages/client/src/cli.ts"], {
    env: { ...process.env, BOT_WS_URL: `ws://localhost:${WS_PORT}`, CLIENT_TOKEN: TOKEN_B },
    stdio: "inherit",
  });

  try {
    await waitFor(() => hub.isTokenOnline(TOKEN_A) && hub.isTokenOnline(TOKEN_B), 15000, "both clients online");
    console.log("[multi-smoke] both clients online");

    // Fire two requests in parallel; each reply must carry the token-specific marker.
    const [replyA, replyB] = await Promise.all([
      hub.sendToToken(TOKEN_A, {
        type: "user_message",
        id: hub.newRequestId(),
        text: "Reply with exactly: TOKEN_A_OK",
      }),
      hub.sendToToken(TOKEN_B, {
        type: "user_message",
        id: hub.newRequestId(),
        text: "Reply with exactly: TOKEN_B_OK",
      }),
    ]);

    const textA = replyA.type === "reply" ? replyA.text : `[${replyA.type}]`;
    const textB = replyB.type === "reply" ? replyB.text : `[${replyB.type}]`;
    console.log("[multi-smoke] A reply:", textA.slice(0, 80));
    console.log("[multi-smoke] B reply:", textB.slice(0, 80));

    const aOk = textA.includes("TOKEN_A_OK");
    const bOk = textB.includes("TOKEN_B_OK");
    const noLeak = !textA.includes("TOKEN_B_OK") && !textB.includes("TOKEN_A_OK");

    if (aOk && bOk && noLeak) {
      console.log("[multi-smoke] ✓ PASS — both clients responded independently, no cross-talk");
    } else {
      console.log(`[multi-smoke] ✗ FAIL — aOk=${aOk} bOk=${bOk} noLeak=${noLeak}`);
    }
  } catch (err) {
    console.error("[multi-smoke] ✗ FAIL —", err);
  } finally {
    childA.kill();
    childB.kill();
    setTimeout(() => process.exit(0), 500);
  }
}

main();
