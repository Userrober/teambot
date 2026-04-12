# TeamBot 架构设计文档

## 整体定位

本地 Teams Bot，作为 Claude Code CLI 的远程交互界面。不部署到云端，所有组件运行在本地开发机上。

支持两条独立的使用方式，可以同时工作：
- **方式 A**：在终端里使用 Claude Code，对话自动镜像到 Teams
- **方式 B**：在 Teams/Playground 里直接跟 Claude 对话

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                            本地开发机                                │
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────────┐    │
│  │ Claude Code  │    │   Bot 服务    │    │ Teams / Playground │    │
│  │   Terminal   │    │ localhost:3978│    │                    │    │
│  │              │    │              │    │                    │    │
│  │ 你在这里     │    │  Node.js     │    │  你也可以在这里    │    │
│  │ 跟我对话     │    │  常驻进程     │    │  跟 Claude 对话   │    │
│  └──────┬───────┘    └──────┬───────┘    └────────┬───────────┘    │
│         │                   │                     │                │
│         │    hooks          │    Bot Framework     │                │
│         └───────────────────┘─────────────────────┘                │
│                                                                     │
│  ┌─────────────────────────────────────────────┐                   │
│  │          Claude Code CLI (claude)            │                   │
│  │  磁盘上的 session 数据 (~/.claude/projects/) │                   │
│  └─────────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────┘
```

## 两条使用方式

### 方式 A：从终端使用（镜像到 Teams）

用户在终端跟 Claude Code 对话，hook 把对话实时同步到 Teams 供别人查看。

```
用户输入消息
  → UserPromptSubmit hook 触发
    → POST /api/push {session_id, text: "User: 你的消息"}
      → Bot 调用 sendDirect() → Playground connector API
        → Teams 中显示用户的输入

Claude 回复
  → Stop hook 触发
    → POST /api/push {session_id, text: "Claude 的回复"}
      → Bot 调用 sendDirect() → Playground connector API
        → Teams 中显示 Claude 的回复
```

这条链路里 Claude CLI 不被 Bot 调用，Claude 跑在用户的终端进程里。Bot 只负责转发消息到 Teams。

### 方式 B：从 Teams/Playground 使用

用户直接在 Teams 里跟 Claude 对话。

```
用户在 Playground 输入 "你好"
  → Playground 发 HTTP POST 到 localhost:3978/api/messages
    → Bot message handler 收到
      → Bot spawn: claude -p --resume <sessionId> --output-format json --model ...
      → 通过 stdin 把 "你好" 传给 CLI
      → CLI 加载 session 历史，处理请求，stdout 输出 JSON
      → Bot 解析 JSON，提取 result
      → Bot 用 context.send() 回复到 Playground
    → 用户在 Playground 看到回复
```

每次消息都 spawn 新 CLI 进程，但通过 `--resume` 共享 session 历史，对话是连续的。

## 核心组件

### 1. Bot 服务 (`app.ts` + `index.ts`)

常驻在 3978 端口的 Node.js 进程。负责：

- **接收 Teams 消息** — `app.on("message")` 处理所有来自 Teams/Playground 的消息
- **命令处理** — `/help` `/reset` `/status` `/model` `/compact` `/diag`
- **转发给 Claude CLI** — 非命令消息通过 `ClaudeCodeBridge` 调用 CLI
- **HTTP API** — 供终端 hook 调用

#### HTTP API

| 端点 | 方法 | 用途 | 请求体 |
|------|------|------|--------|
| `/api/messages` | POST | Bot Framework 消息入口（Teams/Playground 自动调用） | Activity JSON |
| `/api/push` | POST | 终端推送消息到 Teams | `{ session_id, text }` |
| `/api/register` | POST | 终端注册 session | `{ session_id }` |
| `/api/inbox` | POST | 终端拉取 Teams 来的消息 | `{ session_id }` |

#### Bot 命令

| 命令 | 功能 |
|------|------|
| `/help` | 显示帮助信息 |
| `/reset` | 重置 Claude session，下次对话从头开始 |
| `/status` | 显示当前 session 状态（消息数、费用、是否繁忙等） |
| `/model` | 查看当前模型和可选列表 |
| `/model <number 或 name>` | 切换模型（如 `/model 2`、`/model sonnet`） |
| `/compact` | 压缩当前对话上下文 |
| `/diag` | 显示原始 Activity JSON |

### 2. Claude Code Bridge (`claude-bridge.ts`)

管理 Claude CLI 的调用。每个 Teams conversation 对应一个独立的 Claude session。

```
ClaudeCodeBridge
  ├── sessions: Map<conversationId, ConversationSession>  // 内存中的活跃 session
  ├── sessionStore: SessionStore                           // 持久化到磁盘
  │
  ├── sendMessage(conversationId, text)
  │     → getOrCreateSession()     // 从内存或 store 恢复 session
  │     → invokeClaude()           // spawn CLI 进程
  │     │   → claude -p --resume <id> --output-format json
  │     │   → stdin.write(text)    // 用户消息通过 stdin 传入（避免 shell 注入）
  │     │   → 等待 stdout JSON     // 解析 ClaudeResult
  │     → 保存 session_id 到 store // 持久化供重启恢复
  │     → return result.result     // 返回回复文本
  │
  ├── resetSession(conversationId)  // 清除 session，下次对话从头开始
  ├── setModel(name)                // 动态切换模型
  ├── getModel()                    // 查询当前模型
  └── getSessionStatus()            // 查询 session 状态（消息数、费用等）
```

**消息队列**：如果一个 session 正在处理消息（busy），新消息排队等待，最多 5 条。超过后拒绝并返回错误。

**错误恢复**：如果 `--resume` 失败（session 过期或损坏），自动清除 session ID，以全新 session 重试一次。

### 3. Session Store (`session-store.ts`)

状态持久化到 `bot-state.json`，Bot 重启后可恢复。

```json
{
  "channelConversationId": "...",
  "connectorUrl": "http://localhost:56150/_connector",
  "threads": [
    {
      "sessionId": "task-1",
      "channelConversationId": "...",
      "threadActivityId": "",
      "createdAt": "2026-04-12T..."
    }
  ],
  "claudeSessions": {
    "conv-abc-123": "session-xyz-456"
  }
}
```

字段说明：
- `channelConversationId` — 最近一个 Teams/Playground conversation ID
- `connectorUrl` — 来自 incoming activity 的 serviceUrl，用于 `/api/push` 推送
- `threads` — 终端 session 注册信息
- `claudeSessions` — conversation ID 到 Claude session ID 的映射，跨重启保留

### 4. Hooks (`~/.claude/hooks/`)

注册在 `~/.claude/settings.json`，Claude Code 在特定事件时自动触发。

| Hook 文件 | 触发事件 | 功能 |
|-----------|----------|------|
| `push-to-teams.sh` | `Stop`（Claude 回复后） | 读取 `last_assistant_message`，POST 到 Bot `/api/push` |
| `push-prompt-to-teams.sh` | `UserPromptSubmit`（用户输入后） | 读取 `prompt`，POST 到 Bot `/api/push` |

两个 hook 从 `~/.claude/teams-session` 读取连接信息：

```
task-1                    ← SESSION_ID
http://localhost:3978     ← BOT_URL
```

`settings.json` 中的注册：

```json
{
  "hooks": {
    "Stop": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "bash ~/.claude/hooks/push-to-teams.sh", "timeout": 10 }]
    }],
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "bash ~/.claude/hooks/push-prompt-to-teams.sh", "timeout": 10 }]
    }]
  }
}
```

### 5. 连接脚本 (`scripts/`)

```bash
# 连接终端到 Teams：注册 session + 写 ~/.claude/teams-session
bash scripts/connect-teams.sh task-1

# 断开连接：删除 ~/.claude/teams-session，hook 不再触发
bash scripts/disconnect-teams.sh
```

## `/api/push` 推送机制

Bot 如何把消息发到 Teams/Playground：

```
/api/push 收到请求
  │
  ├→ 有 lastServiceUrl？（来自最近一次 Teams/Playground 发的消息）
  │    → 是：sendDirect(lastServiceUrl, lastConversationId, text)
  │
  ├→ 否：从 bot-state.json 读取 connectorUrl
  │    → 有：sendDirect(connectorUrl, channelConversationId, text)
  │
  └→ 都没有：返回 503 错误
       "Bot has not received any Teams message yet"
```

`sendDirect()` 直接调用 Bot Framework Connector REST API：

```
POST {serviceUrl}/v3/conversations/{conversationId}/activities
Body: { type: "message", text: "...", from: { id: "bot", name: "Claude Code Bot" } }
```

这个机制在 Playground 和 Teams 客户端模式下都能工作。

## Session 生命周期

```
用户第一次在 Playground 发消息
  → claudeBridge.sendMessage("conv-123", "你好")
    → getOrCreateSession("conv-123")
      → store 里没有 → 新建 session，claudeSessionId = null
    → invokeClaude(): claude -p --output-format json  （无 --resume）
    → 得到 response.session_id = "sess-abc"
    → 保存到内存 + bot-state.json

用户第二次发消息
  → claudeBridge.sendMessage("conv-123", "继续")
    → getOrCreateSession("conv-123")
      → 内存中有 session，claudeSessionId = "sess-abc"
    → invokeClaude(): claude -p --resume sess-abc --output-format json
    → Claude 加载历史上下文，继续对话

Bot 重启后用户发消息
  → getOrCreateSession("conv-123")
    → 内存中没有 → 从 bot-state.json 读取 claudeSessionId = "sess-abc"
  → invokeClaude(): claude -p --resume sess-abc
  → 对话恢复

用户发 /reset
  → claudeBridge.resetSession("conv-123")
    → 清除内存中的 session
    → 清除 bot-state.json 中的 claudeSessionId
  → 下次发消息时创建全新 session
```

## 项目文件结构

```
teambot/
├── index.ts                  # 入口，启动 App 监听端口
├── app.ts                    # Bot 主逻辑：消息处理、命令、HTTP API
├── claude-bridge.ts          # Claude CLI 调用管理
├── claude-types.ts           # TypeScript 类型定义
├── config.ts                 # 环境变量映射
├── session-store.ts          # 状态持久化
├── bot-state.json            # 运行时持久化状态（自动生成）
├── teams-messages.log        # 消息日志（自动生成）
├── inbox/                    # 消息队列目录（自动生成）
├── scripts/
│   ├── connect-teams.sh      # 连接终端到 Teams
│   └── disconnect-teams.sh   # 断开连接
├── package.json
├── tsconfig.json
├── CLAUDE.md                 # Claude Code 项目指引
├── DESIGN.md                 # 功能规划与路线图
├── env/                      # 环境配置文件
├── infra/                    # Azure 部署 Bicep 模板
└── appPackage/               # Teams App 包

~/.claude/
├── settings.json             # Claude Code hooks 注册
├── teams-session             # 当前连接状态（SESSION_ID + BOT_URL）
└── hooks/
    ├── push-to-teams.sh      # Stop hook：Claude 回复 → Teams
    └── push-prompt-to-teams.sh  # UserPromptSubmit hook：用户输入 → Teams
```

## 环境变量

### Bot 配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | Bot 监听端口 | `3978` |
| `CLIENT_ID` | Azure Bot App ID | — |
| `CLIENT_SECRET` | Azure Bot App Secret（本地开发） | — |
| `TENANT_ID` | Azure AD 租户 ID | — |
| `BOT_TYPE` | 认证类型 | — |

### Claude CLI 配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CLAUDE_CLI_PATH` | Claude CLI 路径 | `claude` |
| `CLAUDE_MODEL` | 模型 | `claude-opus-4-6-20250514` |
| `CLAUDE_WORKING_DIR` | CLI 工作目录 | 当前目录 |
| `CLAUDE_TIMEOUT_MS` | 超时（毫秒） | `120000` |
| `CLAUDE_MAX_BUDGET_USD` | 单次最大费用 | `1.0` |
| `CLAUDE_BARE` | bare 模式 | `true` |
| `CLAUDE_SKIP_PERMISSIONS` | 跳过权限确认 | `false` |
| `CLAUDE_SYSTEM_PROMPT` | 追加系统提示 | — |

## 启动步骤

```bash
# 1. 启动 Bot
PORT=3978 npx ts-node ./index.ts

# 2. 启动 Playground
agentsplayground start --app-endpoint http://localhost:3978/api/messages

# 3.（可选）连接终端到 Teams
bash scripts/connect-teams.sh task-1

# 4. 在 Playground 发消息测试
# 5.（可选）断开终端
bash scripts/disconnect-teams.sh
```
