# TeamBot — Claude Code × Microsoft Teams 双向桥接

## 项目定位

将 Microsoft Teams 作为本地 Claude Code CLI 的远程交互界面。用户可以在 Teams 中查看终端对话的实时镜像，也可以从 Teams 发送消息让 Claude Code 处理并回复。

**不部署到云端**，所有组件运行在本地开发机上，通过 dev tunnel 或 M365 Agents Playground 连接到 Teams 客户端。

---

## 架构总览

```
┌─────────────────────────┐                              ┌─────────────────────────┐
│   Claude Code Terminal  │                              │   Teams / Playground    │
│                         │                              │                         │
│                         │   ① Stop hook                │                         │
│   Claude 回复 ──────────────────────────────────────→   显示 Claude 回复        │
│                         │   ② UserPromptSubmit hook    │                         │
│   用户在终端输入 ────────────────────────────────────→   显示用户输入            │
│                         │                              │                         │
│                         │   ③ Bot message handler      │                         │
│   (独立 CLI 进程)  ←───────── claude -p --resume ←────── Teams 用户发消息       │
│                         │       ↓                      │                         │
│                         │   Claude 回复 ──────────────→  显示回复               │
└─────────────────────────┘                              └─────────────────────────┘
                │                     │
                │    localhost:3978    │
                └─────────┬───────────┘
                    ┌─────┴─────┐
                    │  Bot 服务  │
                    │  (Node.js) │
                    └───────────┘
```

### 三条数据链路

| # | 方向 | 触发方式 | 实现机制 | 状态 |
|---|------|----------|----------|------|
| ① | Claude 回复 → Teams | 自动（每次回复后触发） | `Stop` hook → Playground connector API / Bot `/api/push` | ✅ Playground 模式可用 |
| ② | 终端用户输入 → Teams | 自动（每次输入时触发） | `UserPromptSubmit` hook → Playground connector API / Bot `/api/push` | ✅ Playground 模式可用 |
| ③ | Teams 用户发消息 → Claude | 自动（Bot 收到消息时处理） | Bot message handler → `claude -p --resume` → 回复发回 Teams | ❌ 未跑通 |

**重要说明：** 链路 ③ 不是注入当前终端进程，而是 Bot 独立 spawn 一个 Claude CLI 进程，通过 `--resume <sessionId>` 共享同一个对话历史。

---

## 组件说明

### 1. Bot 服务（核心）

| 文件 | 职责 |
|------|------|
| `index.ts` | 入口，启动 App 监听 3978 端口 |
| `app.ts` | Bot 主逻辑：消息路由、命令处理、Claude CLI 调用、HTTP API |
| `claude-bridge.ts` | `ClaudeCodeBridge` 类：管理 Claude CLI 进程，spawn/resume/queue |
| `claude-types.ts` | TypeScript 类型定义：CLI 输出格式、Bridge 配置、Session 状态 |
| `config.ts` | 环境变量映射：Bot 认证、Claude CLI 参数 |
| `session-store.ts` | 会话状态管理：thread 绑定、inbox/outbox、持久化到 `bot-state.json` |

#### Bot 提供的 HTTP API

| 端点 | 方法 | 用途 | 请求体 |
|------|------|------|--------|
| `/api/messages` | POST | Bot Framework 消息入口（Teams/Playground 自动调用） | Activity JSON |
| `/api/register` | POST | 终端注册 session | `{ session_id: "task-1" }` |
| `/api/push` | POST | 终端推送消息到 Teams | `{ session_id: "task-1", text: "..." }` |
| `/api/inbox` | POST | 终端拉取 Teams 来的消息 | `{ session_id: "task-1" }` |

#### Bot 命令（在 Teams/Playground 中输入）

| 命令 | 功能 |
|------|------|
| `/help` | 显示帮助信息 |
| `/threads` | 列出活跃的终端 session |
| `/diag` | 显示原始 Activity JSON |

### 2. Claude Code Hooks（终端侧）

安装在 `~/.claude/hooks/`，通过 `~/.claude/settings.json` 注册。

| Hook 文件 | 事件 | 功能 |
|-----------|------|------|
| `push-to-teams.sh` | `Stop` | Claude 回复后，推送回复内容到 Teams |
| `push-prompt-to-teams.sh` | `UserPromptSubmit` | 用户输入后，推送输入内容到 Teams |

Hook 读取 `~/.claude/teams-session` 获取连接信息，然后调用目标 API 推送消息。

### 3. 连接脚本

| 脚本 | 用途 |
|------|------|
| `scripts/connect-teams.sh` | 建立终端与 Teams 的连接，写入 `~/.claude/teams-session` |
| `scripts/disconnect-teams.sh` | 断开连接，删除 `~/.claude/teams-session` |

### 4. 状态文件

| 文件 | 位置 | 内容 |
|------|------|------|
| `~/.claude/teams-session` | 用户目录 | 当前连接的 connector URL 和 conversation ID |
| `bot-state.json` | 项目目录 | Bot 的持久化状态：channel ID、thread 绑定、outbox |
| `inbox/<sessionId>.jsonl` | 项目目录 | 各 session 的待读消息队列 |
| `teams-messages.log` | 项目目录 | Bot 消息日志 |

---

## 运行模式

### Playground 模式（当前开发用）

不需要 Teams 客户端和 Azure 注册，所有组件在本地运行。

**限制：**
- `app.send()`（Bot Framework 主动推送）不可用
- Hook 直接调用 Playground connector API (`http://localhost:56150/_connector`) 绕过 Bot 推送
- 需要手动运行 `agentsplayground start` 启动 Playground

**启动步骤：**
```bash
# 1. 启动 Bot
npm run dev        # 或 PORT=3978 npx ts-node ./index.ts

# 2. 启动 Playground
agentsplayground start --app-endpoint http://localhost:3978/api/messages

# 3. 在终端连接到 Playground
bash scripts/connect-teams.sh [conversationId] [playground_port]
```

### Teams 客户端模式（目标）

通过 dev tunnel 连接到本地 Teams 客户端，Bot Framework 认证生效，`app.send()` 可用。

**需要：**
- M365 Agents Toolkit VS Code 扩展
- Dev tunnel（Toolkit 自动管理）
- Azure Bot 注册（Toolkit 自动 provision）
- 有效的 `CLIENT_ID` / `CLIENT_SECRET` / `TENANT_ID`

**启动步骤：**
```bash
# VS Code 按 F5，选择 Teams (Edge/Chrome/Desktop)
# Toolkit 自动：编译 → 启动 Bot → 创建 tunnel → 打开 Teams
```

---

## 需要完成的功能

### P0 — 核心功能

#### 1. Teams → Claude CLI 链路跑通
**现状：** `app.ts` 里有 `claudeBridge.sendMessage()` 调用，但被 session/thread 路由拦截，消息走了 inbox 而没到 Claude bridge。
**需要：**
- 清理 message handler 路由逻辑，当没有 terminal session 绑定时走 Claude bridge
- 或者反过来：所有非命令消息都走 Claude bridge，去掉 inbox/thread 路由
- 测试 `claude -p --resume` 在 Windows 上正常工作
- 处理 Claude CLI 超时和错误，返回友好提示

#### 2. Session 管理
**现状：** `claude-bridge.ts` 用内存 Map 管理 session，Bot 重启后丢失。
**需要：**
- Claude session ID 持久化（可复用 `bot-state.json`）
- `/reset` 命令重置某个 conversation 的 Claude session
- Session 超时清理策略

#### 3. Hook 推送走 Bot `/api/push`（统一链路）
**现状：** Hook 直接调用 Playground connector API，绕过了 Bot。
**需要：**
- Hook 改为调用 Bot 的 `/api/push`，由 Bot 统一负责推送
- `/api/push` 在 Playground 模式下用 connector API 直推，在 Teams 模式下用 `app.send()`
- 这样切换运行模式时 hook 不需要改

### P1 — 体验优化

#### 4. 长消息处理
**现状：** `splitMessage()` 函数已有，但只在部分链路使用。
**需要：**
- Claude 回复可能很长，需要在所有推送链路中统一分片
- Teams 消息长度限制约 28KB，需要可靠的分片和顺序发送

#### 5. Markdown 渲染
**现状：** 消息以纯文本发送。
**需要：**
- Claude 的回复通常包含 Markdown 格式
- Teams 支持 Adaptive Cards 或 HTML 格式化
- 至少支持代码块的格式化显示

#### 6. 多 Conversation 支持
**现状：** `claudeBridge` 用 conversationId 作为 key 管理 session，理论上支持多个对话。
**需要：**
- 验证多个 Teams conversation（1:1 聊天 vs 群聊 vs Channel）同时工作
- 每个 conversation 独立的 Claude session

#### 7. Typing 指示器
**需要：**
- Claude 处理中时在 Teams 显示 "typing..."
- 长任务时定期发送 typing 保持连接

### P2 — 生产就绪

#### 8. Teams 客户端认证修复
**现状：** 之前测试时 `app.send()` 报 401 错误。
**需要：**
- 排查 `CLIENT_ID` / `CLIENT_SECRET` 配置
- 确认 dev tunnel + Bot registration 配置正确
- 验证 `app.send()` 在 Teams 客户端模式下工作

#### 9. 安全加固
**需要：**
- `/api/push`、`/api/register`、`/api/inbox` 添加认证（目前任何人都能调用）
- Claude CLI 输入清理（避免 prompt injection）
- 限制可以调用 Bot 的 Teams 用户/tenant

#### 10. 错误恢复
**需要：**
- Bot 崩溃重启后自动恢复 session
- Claude CLI 进程挂死的超时和清理
- 网络断开后的重连机制

---

## 环境变量

### Bot 配置
| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | Bot 监听端口 | `3978` |
| `CLIENT_ID` | Azure Bot 注册的 App ID | — |
| `CLIENT_SECRET` | Azure Bot 注册的 App Secret（本地开发） | — |
| `TENANT_ID` | Azure AD 租户 ID | — |
| `BOT_TYPE` | 认证类型（`UserAssignedMsi` 用于 Azure 部署） | — |

### Claude CLI 配置
| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CLAUDE_CLI_PATH` | Claude CLI 可执行文件路径 | `claude` |
| `CLAUDE_MODEL` | 使用的模型 | `sonnet` |
| `CLAUDE_WORKING_DIR` | Claude CLI 工作目录 | 当前目录 |
| `CLAUDE_TIMEOUT_MS` | CLI 调用超时（毫秒） | `120000` |
| `CLAUDE_MAX_BUDGET_USD` | 单次调用最大费用 | `1.0` |
| `CLAUDE_BARE` | 是否使用 bare 模式 | `true` |
| `CLAUDE_SKIP_PERMISSIONS` | 是否跳过权限确认 | `false` |
| `CLAUDE_SYSTEM_PROMPT` | 追加的系统提示 | — |

---

## 项目文件结构

```
teambot/
├── index.ts                  # 入口
├── app.ts                    # Bot 主逻辑
├── claude-bridge.ts          # Claude CLI 调用桥接
├── claude-types.ts           # TypeScript 类型
├── config.ts                 # 环境变量配置
├── session-store.ts          # 会话状态管理
├── bot-state.json            # 持久化状态（运行时生成）
├── teams-messages.log        # 消息日志（运行时生成）
├── inbox/                    # 消息队列目录（运行时生成）
├── scripts/
│   ├── connect-teams.sh      # 连接终端到 Teams
│   └── disconnect-teams.sh   # 断开连接
├── package.json
├── tsconfig.json
├── CLAUDE.md                 # Claude Code 项目指引
├── env/                      # 环境配置文件
├── infra/                    # Azure 部署 Bicep 模板
│   ├── azure.bicep
│   └── botRegistration/
│       └── azurebot.bicep
└── appPackage/               # Teams App 包

~/.claude/
├── settings.json             # Claude Code hooks 注册
├── teams-session             # 当前连接状态
└── hooks/
    ├── push-to-teams.sh      # Stop hook
    └── push-prompt-to-teams.sh  # UserPromptSubmit hook
```
