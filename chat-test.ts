import * as http from "http";

const BOT_URL = "http://localhost:3978";

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Teams Bot Test</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #eee; height: 100vh; display: flex; flex-direction: column; }
  #header { padding: 16px; background: #16213e; text-align: center; font-size: 18px; font-weight: 600; border-bottom: 1px solid #0f3460; }
  #messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .msg { max-width: 80%; padding: 10px 14px; border-radius: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; font-size: 14px; }
  .msg.user { align-self: flex-end; background: #0f3460; }
  .msg.bot { align-self: flex-start; background: #2a2a4a; }
  .msg.system { align-self: center; color: #888; font-size: 12px; }
  #input-area { display: flex; padding: 12px; background: #16213e; border-top: 1px solid #0f3460; gap: 8px; }
  #input { flex: 1; padding: 10px 14px; border-radius: 8px; border: 1px solid #0f3460; background: #1a1a2e; color: #eee; font-size: 14px; outline: none; }
  #input:focus { border-color: #e94560; }
  #send { padding: 10px 20px; border-radius: 8px; border: none; background: #e94560; color: white; font-size: 14px; cursor: pointer; }
  #send:hover { background: #c73e54; }
  #send:disabled { background: #555; cursor: not-allowed; }
  .spinner { display: inline-block; width: 20px; height: 20px; border: 2px solid #555; border-top-color: #e94560; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div id="header">Teams Bot Test UI (simulates Teams client)</div>
<div id="messages">
  <div class="msg system">This simulates a Teams client. Try: /connect &lt;session_id&gt;, /help, or send any message.</div>
</div>
<div id="input-area">
  <input id="input" placeholder="Type a message..." autofocus />
  <button id="send">Send</button>
</div>
<script>
const msgs = document.getElementById('messages');
const input = document.getElementById('input');
const send = document.getElementById('send');
const convId = 'test-conv-' + Date.now();

function addMsg(text, cls) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  d.textContent = text;
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
  return d;
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;
  addMsg(text, 'user');
  input.value = '';
  send.disabled = true;
  const loading = addMsg('', 'bot');
  loading.innerHTML = '<div class="spinner"></div> Sending to bot...';

  try {
    const res = await fetch('/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: convId, text, from: 'TestUser' })
    });
    const data = await res.json();
    loading.textContent = data.error ? 'Error: ' + data.error : data.reply || '(message sent)';
  } catch (e) {
    loading.textContent = 'Error: ' + e.message;
  }
  send.disabled = false;
  input.focus();
}

// Poll for proactive messages
setInterval(async () => {
  try {
    const res = await fetch('/poll?convId=' + convId);
    const data = await res.json();
    if (data.messages) {
      for (const m of data.messages) {
        addMsg('[Push] ' + m.text, 'bot');
      }
    }
  } catch(e) {}
}, 2000);

send.onclick = sendMessage;
input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
</script>
</body>
</html>`;

// Store proactive messages per conversation for polling
const proactiveMessages: Map<string, Array<{text: string}>> = new Map();

const PORT = 3979;

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);
    return;
  }

  // Poll for proactive messages
  if (req.method === "GET" && req.url?.startsWith("/poll")) {
    const convId = new URL(req.url, "http://localhost").searchParams.get("convId") || "";
    const msgs = proactiveMessages.get(convId) || [];
    proactiveMessages.set(convId, []);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ messages: msgs }));
    return;
  }

  if (req.method === "POST" && req.url === "/send") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { conversationId, text, from } = JSON.parse(body);

    // Simulate sending a Bot Framework Activity to the bot
    const activity = {
      type: "message",
      text,
      from: { id: from || "test-user", name: from || "Test User" },
      conversation: { id: conversationId },
      recipient: { id: "bot", name: "Bot" },
      channelId: "emulator",
      serviceUrl: `http://localhost:${PORT}`,
    };

    try {
      // Post to bot's messaging endpoint
      const botRes = await fetch(`${BOT_URL}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activity),
      });

      // The bot will try to reply via serviceUrl, which we handle below
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reply: "Message sent to bot. Check for reply." }));
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: errMsg }));
    }
    return;
  }

  // Handle bot's reply callback (Bot Framework sends replies here)
  if (req.method === "POST" && req.url?.includes("/v3/conversations/")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const activity = JSON.parse(body);
      const convId = req.url.match(/conversations\/([^/]+)/)?.[1] || "";
      if (activity.text) {
        const msgs = proactiveMessages.get(convId) || [];
        msgs.push({ text: activity.text });
        proactiveMessages.set(convId, msgs);
      }
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "1" }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\nTeams Bot Test UI running at http://localhost:${PORT}\n`);
});
