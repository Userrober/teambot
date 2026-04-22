# TeamBot 多人架构 — 完整实现规划

> 目标：把现在的"一人一 Bot"模式升级为"一个 Bot 服务多人"，每个用户在自己电脑上跑 Claude Code，使用自己的账号、自己的工作目录、自己的工具。**保留 README 中的所有现有功能**。

---

## 目录

1. [背景与核心思路](#1-背景与核心思路)
2. [架构总览](#2-架构总览)
3. [关键概念详解](#3-关键概念详解)
4. [现有功能如何保留](#4-现有功能如何保留)
5. [实现阶段划分](#5-实现阶段划分)
6. [WebSocket 协议规范](#6-websocket-协议规范)
7. [代码与目录结构](#7-代码与目录结构)
8. [部署方案](#8-部署方案)
9. [安全与可靠性](#9-安全与可靠性)
10. [用户上手流程](#10-用户上手流程)
11. [开发任务清单](#11-开发任务清单)

---

## 1. 背景与核心思路

### 1.1 现状的问题

现在的部署模式是 **"一人一套"**：

```
你的 Teams ──► Bot 注册（Azure，云上）──► Dev Tunnel ──► 你电脑上的 Node 进程
                                                            │
                                                            └─ spawn claude CLI（你的账号、你的代码）
```

如果朋友也想用，他要从头做一遍：注册 Bot、配 Dev Tunnel、改 `.localConfigs`、装 Claude CLI、跑 npm，**80 分钟起步且要懂技术**。

如果让朋友用你的 Bot，他的消息会落到**你的 Node 进程**，spawn 的 Claude 用的是**你的账号**，碰的是**你的文件**——不是真正的"多人"。

### 1.2 核心思路：Bot 变薄，计算下沉

把 Bot 拆成两层：

- **Bot（云端）**：纯路由。收 Teams 消息，找到对应用户的客户端，转发。**不跑 Claude，不读用户文件，零业务逻辑。**
- **客户端（用户电脑）**：每个用户自己跑一份。维持到 Bot 的 WebSocket，收到任务就 spawn 本地 Claude CLI。**用户用自己的账号、自己的代码、自己的工具。**

这样：
- Bot 是无状态路由，一台 App Service 撑成百上千用户没问题
- 每用户的 Claude 在自己电脑跑，天然隔离
- 用户上手成本：装客户端 + Teams 装 zip + `/pair` 一次
- **README 的所有功能 100% 保留**（详见 §4）

---

## 2. 架构总览

```
┌────────────────────────────────────────────────────────────────────┐
│                         第 1 层：Teams                              │
│  - 用户 A 的 Teams                       用户 B 的 Teams             │
│  - 用户 C 的 Teams                       …                          │
└────────────────────────────────────────────────────────────────────┘
                              │  Bot Framework
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                第 2 层：Bot（部署一次，云端 App Service）             │
│                                                                    │
│  ┌─────────────────────┐         ┌──────────────────────────────┐  │
│  │  HTTP Endpoint      │         │  WebSocket Hub               │  │
│  │  /api/messages      │         │  - 维持所有客户端的长连接      │  │
│  │  (收 Teams 消息)     │ ──────► │  - aadObjectId → token →     │  │
│  │                     │         │    websocket 路由表           │  │
│  └─────────────────────┘         │  - pending request 关联       │  │
│           │                       └──────────────────────────────┘  │
│           ▼                                       │                 │
│  ┌─────────────────────┐                          │                 │
│  │  命令路由器           │                          │                 │
│  │  /help /diag 本地处理 │                          │                 │
│  │  其余转发给客户端     │                          │                 │
│  └─────────────────────┘                          │                 │
│                                                   │                 │
│  ┌─────────────────────┐                          │                 │
│  │  存储                │                          │                 │
│  │  Cosmos / Table      │                          │                 │
│  │  - 配对关系          │                          │                 │
│  │  - serviceUrl 等     │                          │                 │
│  └─────────────────────┘                          │                 │
└───────────────────────────────────────────────────┼─────────────────┘
                                                    │
                                          WebSocket 长连接（双向）
                                                    │
                  ┌─────────────────────────────────┼─────────────────────────┐
                  ▼                                 ▼                         ▼
         ┌──────────────────┐            ┌──────────────────┐        ┌──────────────────┐
         │  用户 A 客户端    │            │  用户 B 客户端    │        │  用户 C 客户端    │
         │  (A 的电脑)       │            │  (B 的电脑)       │        │  (C 的电脑)       │
         │  ─────────────   │            │  ─────────────   │        │  ─────────────   │
         │  WS Client       │            │  WS Client       │        │  WS Client       │
         │  本地 HTTP :9999 │ ◄─hook───  │  本地 HTTP :9999 │ ◄hook  │  本地 HTTP :9999 │
         │  Claude Bridge   │            │  Claude Bridge   │        │  Claude Bridge   │
         │      ↓           │            │      ↓           │        │      ↓           │
         │  spawn claude    │            │  spawn claude    │        │  spawn claude    │
         │  ~/.claude (A)   │            │  ~/.claude (B)   │        │  ~/.claude (C)   │
         │  A 的工作目录     │            │  B 的工作目录     │        │  C 的工作目录     │
         └──────────────────┘            └──────────────────┘        └──────────────────┘
```

**一句话**：Bot = 邮局；客户端 = 收信人 + 工厂。Bot 不生产任何东西，只把 Teams 的"订单"转给对的人，把人家做好的东西寄回 Teams。

---

## 3. 关键概念详解

### 3.1 用户身份与配对（Pairing）

**问题**：Bot 收到一条 Teams 消息，怎么知道转给哪个客户端？

**Teams 消息天然带的信息**：每条消息的 `activity.from.aadObjectId`（用户 AAD 唯一 ID）。

**客户端这一侧**：客户端启动时不知道自己属于哪个 Teams 用户。

**桥接它们 = 一次性配对，token 永久持有**：

```
1. 用户在自己电脑装客户端
2. 客户端首次启动时随机生成 token，比如 "ABC-XYZ"
   并存到本地 ~/.claude-teams-client/config.json（永久保留）
   连上 Bot WS，发送 hello { token: "ABC-XYZ" }
3. Bot 暂存：token "ABC-XYZ" → 这条 WebSocket 连接
4. 客户端在终端打印：
   "Pairing token: ABC-XYZ
    Open Teams and send: /pair ABC-XYZ
    (paste this once — Teams will be bound permanently)"
5. 用户在 Teams 里发 /pair ABC-XYZ
6. Bot 从 Teams 消息拿到 aadObjectId
   持久化映射：aadObjectId "user-A-aad" ↔ token "ABC-XYZ"
7. 配对完成且永久生效。以后：
   - 客户端每次启动用同一个 token 重连，Bot 自动认识
   - 用户在 Teams 发任何消息，Bot 用 aadObjectId 查 token，
     用 token 查当前 WebSocket，转发
```

**Token 持久绑定**：
- 一次配对，终身有效（除非用户主动用 `/unpair` 解绑或换设备）
- 客户端的 token 跟随用户：换电脑要重新配对，但同一台机器上重启随便重启
- 同一个 aadObjectId 重复 `/pair` 新 token = 替换旧绑定（用户换机的场景）

### 3.2 双向通信（WebSocket）

**为什么用 WebSocket**：用户电脑大多在 NAT 后面，Bot 主动连不进去。WebSocket 由客户端**主动建连**，建好之后**双向都能发**——所以从 Bot 的角度看就是"我能推消息给你"。

**握手**：
- 客户端启动 → 连 Bot 的 `wss://your-bot.azurewebsites.net/ws`
- 客户端发 `hello { token, clientVersion }`
- Bot 回 `welcome { ... }`
- 之后双方按协议（§6）收发消息

**断线重连**：客户端内置心跳 + 指数退避重连（1s → 2s → 4s → ... → 30s）。Bot 检测到 socket 关闭就把它从路由表里摘掉。

### 3.3 请求关联（Request ID）

Teams 是请求-响应模式（用户发一条，期待一条回复）。WebSocket 是消息流。中间需要关联：

- Bot 发给客户端的每条请求都带 `id`（uuid）
- 客户端处理完回 `id` 不变的响应
- Bot 用 `id` 找到原 Teams context，把回复发回去

```ts
// Bot 端伪代码
const id = uuid();
const reply = await wsHub.send({ type: "user_message", id, text }); // await 解析回 ws 收到的同 id 消息
await teamsContext.send(reply.text);
```

### 3.4 镜像功能的本地端口

终端镜像是"用户在 Claude Code 终端打字 → 推到 Teams"。改造前：

```
终端 hook ──HTTP──► localhost:3978/api/push（Bot 进程）──► Teams
```

改造后：Bot 不在本地了，但**终端和客户端始终在同一台电脑**。所以让客户端开一个本地 HTTP 端口接收 hook：

```
终端 hook ──HTTP──► localhost:9999/push（客户端进程）──WS──► Bot ──► Teams
```

终端配置只改一句：`CLAUDE_BOT_URL=http://localhost:9999`（不改也行，把 9999 设成 3978 也兼容）。

### 3.5 `/resume` 列本地 session

Bot 在云上看不到用户电脑的 `~/.claude/projects/`。流程：

```
Teams 用户发 /resume
  → Bot 识别为命令，不送 Claude
  → Bot 通过 WS：{ type: "list_sessions", id: "x" }
  → 客户端在用户电脑上扫 ~/.claude/projects/
  → 客户端 → Bot：{ type: "session_list", id: "x", items: [...] }
  → Bot 渲染成 Teams 消息回复
```

**核心原则**：所有需要碰用户电脑文件系统的事，全部在客户端做。Bot 只做协议转换和路由。

### 3.6 Bot 的状态管理

| 数据 | 量级 | 存储 |
|---|---|---|
| `aadObjectId → token` 配对关系 | 每用户 1 条 | Cosmos DB（持久化） |
| `token → WebSocket` 当前连接 | 在线用户数 | 内存（重启重建） |
| pending requests | 短暂、活跃请求 | 内存 |
| Teams `serviceUrl`、最近 `conversationId` | 每用户少量 | Cosmos DB |
| 配对 token 临时表 | 5 分钟有效 | 内存（够用） |

**Bot 是接近无状态的**：崩了重启，客户端自动重连，配对关系从 Cosmos 拉回来，2-3 秒就恢复。

---

## 4. 现有功能如何保留

| README 中的功能 | 现在怎么实现 | 新架构中怎么实现 | 用户体验 |
|---|---|---|---|
| Teams 直接对话 | Bot 进程 spawn `claude -p` | Bot 转 WS → 客户端 spawn `claude -p` | 一致 |
| 终端镜像（`npm run connect`） | 终端 hook → Bot HTTP `/api/push` | 终端 hook → 客户端 HTTP `:9999/push` → WS → Bot → Teams | 一致 |
| `npm run disconnect` | 关闭 hook | 关闭 hook（指向客户端的本地端口） | 一致 |
| Handoff（终端→Teams） | `scripts/handoff.sh` POST 到 Bot | `scripts/handoff.sh` POST 到客户端本地端口 → WS → Bot 持久化绑定 | 一致 |
| Takeback（Teams→终端） | `scripts/takeback.sh` POST 到 Bot | `scripts/takeback.sh` POST 到客户端本地端口 → WS → Bot 解除绑定 | 一致 |
| `/help` | Bot 直接回 | Bot 直接回（不需要客户端） | 一致 |
| `/reset` | bridge 删 session | Bot 转 WS → 客户端删 | 一致 |
| `/status` | bridge 返回状态 | Bot 转 WS → 客户端返回状态 → Bot 渲染 | 一致 |
| `/model`（列表） | Bot 拼字符串 + 调 bridge | Bot 拼字符串 + 转 WS 拿当前 model | 一致 |
| `/model <n>` | bridge.setModel | Bot 转 WS → 客户端 setModel | 一致 |
| `/compact` | bridge 发 `/compact` 给 Claude | Bot 转 WS → 客户端发 `/compact` | 一致 |
| `/resume`（列表） | bridge 扫本地 JSONL | Bot 转 WS → 客户端扫本地 JSONL → 回传 | 一致 |
| `/resume <n>` | bridge 绑定 session | Bot 转 WS → 客户端绑定 | 一致 |
| `/diag` | Bot 直接返回 activity JSON | Bot 直接返回（不需要客户端） | 一致 |
| 多模型支持 | `--model` 参数 | 同左（在客户端 spawn） | 一致 |
| Session 持久化 | 本地 `bot-state.json` | 客户端本地持久化（每用户管自己） | 一致 |

**结论：100% 保留，没有功能阉割。** 唯一变化是消息多绕一跳 WebSocket，延迟增加 < 50ms（可忽略）。

---

## 5. 实现阶段划分

### 阶段 1：基础链路（已完成 ✅）

**目标**：单用户场景下验证新链路能跑通。
**简化**：单 token 模式，不做配对、不做用户隔离、不上云。

完成内容：
- 定义 WebSocket 协议（`protocol.ts`）
- Bot 加 WebSocket Hub（`ws-hub.ts`，端口 3979）
- 改写 `app.ts`：所有命令通过 WS 转发
- 抽出客户端（`client/index.ts`）：连 WS + 复用 `claude-bridge.ts`
- 端到端冒烟测试（`scripts/ws-smoke.ts`）✓ PASS

**当前状态**：`npm run start:teams` + `npm run client` 两个进程跑起来，从 Teams 发消息能打通到 Claude 并返回。

---

### 阶段 2：多用户支持

**目标**：多个朋友同时用一个 Bot，每人用自己的客户端。

任务：
1. **Pairing 命令**
   - `/pair <token>` 命令：把 token 永久绑定到当前 aadObjectId
   - `/unpair` 命令：解绑当前用户（换设备时用）
   - 客户端启动时：若本地无 token 则生成并保存到 `~/.claude-teams-client/config.json`，有则复用
   - 客户端首次启动打印 token 提示用户去 Teams 配对
2. **Bot 端 PairingStore**
   - 持久化 `aadObjectId ↔ token` 双向映射
   - 阶段 2 用本地 JSON（阶段 4 换 Cosmos）
   - 重复 `/pair` = 替换旧绑定（支持换机）
3. **WS Hub 多路由**
   - `WsHub.sendTo(aadObjectId, message)` 按用户路由
   - 一个 token 同时只允许一条 WS（新连接踢掉旧的）
   - 用户离线时优雅返回错误
4. **Teams 端用户识别**
   - `app.ts` 用 `activity.from.aadObjectId` 而不是 `lastConversationId`
   - 命令也按用户路由（每人独立）

**验收**：
- 两台电脑各跑一个客户端，各自的 token 持久存储在本地
- 两个 Teams 账号各自 `/pair` 自己的 token
- 重启客户端不需要重新配对
- 同时发消息，互相看不到对方的对话
- 各自的 `/resume` 看到的是各自电脑的 session

**估时**：1.5 天

---

### 阶段 3：客户端打包成独立产品

**目标**：朋友能 `npm install -g claude-teams-client` 一键安装。

任务：
1. **目录拆分**
   - 客户端代码移到 `packages/client/`，独立 `package.json`
   - 共享代码（`protocol.ts`、`claude-bridge.ts`、`claude-types.ts`）放 `packages/shared/`
   - Bot 代码留在原位置，依赖 `packages/shared`
2. **CLI 入口**
   - `bin: { "claude-teams-client": "./dist/cli.js" }`
   - `claude-teams-client` 启动客户端
   - `claude-teams-client config` 改 BOT_URL、查看 token
   - `claude-teams-client status` 查看连接状态
3. **本地 HTTP 服务**
   - 客户端开 `:9999`，对外提供 `/push`、`/handoff`、`/takeback`、`/inbox`
   - 兼容现有 `scripts/connect-teams.sh` 等 hook 脚本
4. **后台守护**
   - 文档：用户用 pm2 / Windows 任务计划 / systemd 守护
   - 内置 `--daemon` 模式（可选）
5. **发布**
   - 发到 npm（公开包）或私有 registry
   - README 引导用户 `npm i -g`

**验收**：
- 朋友一条命令装好客户端
- 配对一次后能正常用所有功能
- 镜像、handoff/takeback 工作正常

**估时**：2 天

---

### 阶段 4：Bot 上云（持久化 + 真部署）

**目标**：Bot 跑在 Azure App Service，不再需要你电脑常开 Dev Tunnel。

任务：
1. **替换 SessionStore**
   - 用 Cosmos DB Table API 替换本地 `bot-state.json`
   - 或用 Azure Table Storage（更便宜）
   - partition key = `aadObjectId`
2. **WebSocket on App Service**
   - App Service 默认支持 WebSocket，需要在 portal 或 Bicep 里开启
   - 改 `infra/azure.bicep`：`webSocketsEnabled: true`、`alwaysOn: true`
3. **Bicep 增量**
   - 加 Cosmos DB / Table Storage 资源
   - 加 Key Vault（如果用了 secrets）
   - 加 role assignment 让 MSI 能读
4. **配置 secrets**
   - 已有的 `BOT_TYPE=UserAssignedMsi` 路径继续用
   - WS 不需要额外 secret，token 是用户生成
5. **部署**
   - `azd up` 或现有 `npm run provision`
   - 客户端的 `BOT_WS_URL` 默认指向 `wss://your-bot.azurewebsites.net/ws`
6. **域名 / SSL**
   - 用默认的 `*.azurewebsites.net` 域名（自带 SSL）即可
   - 想要自定义域名再单独搞

**验收**：
- 关掉本地 Dev Tunnel，朋友用云端 Bot URL
- Bot 重启后客户端自动重连，对话历史不丢
- 多用户并发无串扰

**估时**：1.5 天

---

### 阶段 5：可靠性与体验打磨

**目标**：能交付给非技术用户用。

任务：
1. **错误反馈**
   - 客户端不在线时，Teams 友好提示"你的客户端离线了，请检查"
   - 配对失败、token 过期都有清晰提示
2. **/status 增强**
   - 显示客户端在线状态、最近心跳时间
   - 显示工作目录、Claude CLI 版本
3. **多客户端支持（可选）**
   - 一个 Teams 用户绑多台电脑（家里 + 公司）
   - `/devices` 命令列出已配对设备
   - `/use <device>` 切换当前活动设备
4. **审计日志**
   - 每个用户的请求量、错误率
   - 用 App Insights
5. **Rate limit**
   - 每用户每分钟最多 N 条消息（防止滥用）
6. **文档**
   - 更新 README：新架构、如何安装客户端、配对流程
   - FAQ：客户端离线、token 过期、防火墙

**估时**：2 天

---

### 总估时

| 阶段 | 估时 | 累计 |
|---|---|---|
| 1. 基础链路 | ✅ 已完成 | — |
| 2. 多用户 | 1.5 天 | 1.5 天 |
| 3. 客户端打包 | 2 天 | 3.5 天 |
| 4. 上云 | 1.5 天 | 5 天 |
| 5. 打磨 | 2 天 | 7 天 |

约 **1 周** 能交付给朋友用。

---

## 6. WebSocket 协议规范

### 6.1 消息格式

所有消息都是 JSON，通过 WebSocket text frame 发送。

### 6.2 客户端 → Bot

```ts
// 握手
{ type: "hello", token: string, clientVersion: string }

// 业务响应（带 id 关联）
{ type: "reply", id: string, text: string }
{ type: "error", id: string, message: string }
{ type: "session_list", id: string, items: SessionItem[] }
{ type: "ok", id: string, data?: any }
{ type: "model_info", id: string, current: string }
{ type: "status_info", id: string, data: StatusData }

// 主动推送（无需关联 id）
{ type: "mirror_push", text: string }   // 终端镜像

// 心跳响应
{ type: "pong", id: string }
```

### 6.3 Bot → 客户端

```ts
// 握手响应
{ type: "welcome", workingDir?: string }   // 可选确认

// 业务请求（带 id 等响应）
{ type: "user_message", id: string, text: string }
{ type: "list_sessions", id: string }
{ type: "bind_session", id: string, sessionId: string }
{ type: "reset", id: string }
{ type: "set_model", id: string, model: string }
{ type: "get_model", id: string }
{ type: "status", id: string }
{ type: "compact", id: string }

// 心跳
{ type: "ping", id: string }
```

### 6.4 心跳与超时

- 客户端每 30s 发一次 `ping`
- Bot 60s 没收到 ping 就主动关闭 socket
- 单个请求超时：5 分钟（Claude CLI 可能跑很久）

---

## 7. 代码与目录结构

### 7.1 阶段 1（当前）

```
teambot/
├── index.ts            # Bot 入口
├── app.ts              # Bot 消息处理 + 命令路由
├── ws-hub.ts           # WebSocket 服务器
├── protocol.ts         # 共用协议类型
├── claude-bridge.ts    # Claude CLI 调用（客户端用）
├── claude-types.ts     # 类型定义
├── config.ts           # 环境变量
├── session-store.ts    # 本地状态（待替换）
├── client/
│   └── index.ts        # 客户端进程
├── scripts/
│   ├── ws-smoke.ts     # 端到端测试
│   ├── start.js        # 启动 bot
│   ├── connect-teams.sh
│   ├── handoff.sh
│   └── ...
└── infra/              # Bicep
```

### 7.2 阶段 3 之后（monorepo）

```
teambot/
├── packages/
│   ├── bot/            # 云端 Bot
│   │   ├── package.json
│   │   ├── index.ts
│   │   ├── app.ts
│   │   ├── ws-hub.ts
│   │   └── pairing-store.ts
│   ├── client/         # 用户客户端（发布到 npm）
│   │   ├── package.json   # bin: claude-teams-client
│   │   ├── cli.ts
│   │   ├── ws-client.ts
│   │   ├── local-http.ts  # :9999 hook server
│   │   └── claude-bridge.ts (复制或 import shared)
│   └── shared/         # 共享类型
│       └── protocol.ts
├── infra/              # Bicep
└── docs/
    ├── ARCHITECTURE.md  # 本文档
    ├── CLIENT_SETUP.md  # 客户端安装指南
    └── BOT_DEPLOY.md    # Bot 部署指南
```

---

## 8. 部署方案

### 8.1 Bot（你部署一次）

**资源（在 Azure 上）**：
- App Service B1（~$13/月，已有的 Bicep 已经定义）
- Cosmos DB Serverless（~$0-3/月，按用量）
- Bot Service 注册（免费）

**部署命令**：
```bash
# 现有的就行
npm run provision   # 注册 Bot
azd up              # 或 az deployment group create，部署 Bicep
git push azure main # 推代码
```

**App Service 配置要点**：
- `webSocketsEnabled: true`（Bicep 里加）
- `alwaysOn: true`（已有）
- 环境变量：Cosmos 连接信息、`BOT_TYPE=UserAssignedMsi`

### 8.2 客户端（每个用户）

**前置**：
- Node.js 20+
- Claude Code CLI 已登录

**安装**：
```bash
npm install -g claude-teams-client
```

**配置**：
```bash
claude-teams-client config --bot-url wss://your-bot.azurewebsites.net/ws
```

**启动**：
```bash
claude-teams-client
# → 打印 pairing token
```

**配对**：在 Teams 里给 Bot 发 `/pair <token>`。

**守护**（可选）：
```bash
# Linux/Mac
pm2 start "claude-teams-client" --name claude-teams

# Windows
# 文档教用任务计划程序
```

### 8.3 Teams App 包

你打包一次 zip，所有人共用：
- `appPackage/manifest.json` 里写你的 `botId`（CLIENT_ID）
- 用户在 Teams Admin Center 上传或个人 sideload
- 不需要每人改任何东西

---

## 9. 安全与可靠性

### 9.1 安全模型

| 威胁 | 防御 |
|---|---|
| 别人冒用你的 Bot | Bot 注册时绑定 tenant，只信任你的租户 |
| 别人冒用别人的 token | Token 足够长且随机（128-bit UUID）猜不到；通过 Teams 私聊渠道传递；用户可 `/unpair` 重置 |
| 中间人窃听 WS | wss:// 强制 TLS（App Service 默认） |
| 用户 A 看到用户 B 数据 | Bot 路由严格按 aadObjectId；客户端各自隔离 |
| 客户端被恶意远程命令 | Bot 只发已定义的 protocol 消息；客户端 Claude CLI 用本地权限模式（`auto`） |
| 滥用 Anthropic API 额度 | 各用户自己的 Claude 账号付费；Bot 不持有 API key |

### 9.2 可靠性

| 失效 | 影响 | 处理 |
|---|---|---|
| 用户电脑断网/关机 | 该用户用不了 | Bot 检测 WS 断开，Teams 友好提示 |
| WS 被防火墙掐 | 客户端重连 | 心跳 + 指数退避 + fallback 到 long-polling（备选） |
| Bot 重启 | 所有 WS 断开 | 客户端 1-30s 内自动重连；配对关系从 Cosmos 恢复 |
| Cosmos 不可用 | 新配对失败、老用户无影响（缓存） | App Insights 告警 |
| Claude CLI 挂了 | 该请求失败 | 错误消息回 Teams，用户可重试 |

---

## 10. 用户上手流程

### 10.1 你（部署者）

**一次性**：
1. `npm run provision`（注册 Bot）
2. `azd up`（部署到 Azure）
3. 把 `appPackage/build/appPackage.zip` 发给朋友

**持续**：
- 监控 App Service / Cosmos
- 升级 Bot 代码：`git push azure main`

### 10.2 朋友（使用者）

**一次性（约 5 分钟）**：

```bash
# 1. 装 Node.js（如果没有）
# 2. 装 Claude CLI 并登录
npm install -g @anthropic-ai/claude-code
claude  # 首次登录

# 3. 装客户端
npm install -g claude-teams-client

# 4. 启动客户端
claude-teams-client
# 输出：
# ✓ Connected to bot
# Pairing token: ABC-XYZ
# Open Teams and send: /pair ABC-XYZ

# 5. 在 Teams 装 zip 包（你给的）
#    Teams → Apps → Manage your apps → Upload an app

# 6. 在 Teams 给 Bot 发：
#    /pair ABC-XYZ
#    Bot 回：✓ Paired!
```

**日常使用**：
- 客户端进程一直挂着（pm2 / 任务计划）
- Teams 里直接发消息即可
- 镜像、handoff、takeback 都和现在一模一样

---

## 11. 开发任务清单

### 阶段 2：多用户

- [ ] 客户端启动时若 `~/.claude-teams-client/config.json` 不存在则生成 token 并保存；存在则复用
- [ ] Bot 端 PairingStore（双向 map，本地 JSON 持久化）
- [ ] `/pair <token>` 命令实现（永久绑定，重复 pair 替换旧绑定）
- [ ] `/unpair` 命令实现（解绑当前用户）
- [ ] `WsHub.send` 改为 `WsHub.sendTo(aadObjectId, msg)`
- [ ] 同 token 新连接踢掉旧连接
- [ ] `app.ts` 所有 send 调用补 aadObjectId
- [ ] 多客户端并发测试（启两个客户端模拟两个用户，互不串扰）

### 阶段 3：客户端打包

- [ ] 新建 `packages/client`、`packages/bot`、`packages/shared`
- [ ] 移文件，调 import 路径
- [ ] 客户端 `package.json` 加 `bin`
- [ ] 客户端本地 HTTP 服务（`/push` `/handoff` `/takeback` `/inbox`）
- [ ] 改 `scripts/connect-teams.sh` 指向 `:9999`
- [ ] `claude-teams-client config` / `status` 子命令
- [ ] npm publish 演练（先发到本地 verdaccio）

### 阶段 4：上云

- [ ] Cosmos DB Bicep 资源
- [ ] PairingStore 改成 Cosmos 实现
- [ ] App Service `webSocketsEnabled: true`
- [ ] 部署到 App Service，关闭 Dev Tunnel 测试
- [ ] 客户端默认 BOT_WS_URL 改云端
- [ ] 跨网络断线重连测试

### 阶段 5：打磨

- [ ] 客户端离线时 Teams 友好提示
- [ ] `/status` 显示客户端心跳信息
- [ ] App Insights 接入
- [ ] Rate limit 中间件
- [ ] README 全面重写
- [ ] 录一个 5 分钟安装演示视频

---

## 附录 A：与现有 README 的对应

| README 章节 | 新架构对应 |
|---|---|
| 场景一：终端镜像 | 客户端本地 HTTP 端口接收 hook，转发到 Bot |
| 场景二：Session 共享 | `/resume` 通过 WS 让客户端扫本地；handoff/takeback 同 |
| 前置条件 | 用户：Node + Claude CLI；不再需要 Dev Tunnel、Bot 注册 |
| 完整搭建流程 | 用户跳过所有 provision/configure，直接 `npm i -g` + `/pair` |
| 每日使用 | 一致 |
| Teams 命令 | 全部保留 |
| 工作原理 | 多一跳 WebSocket，其余同 |
| 项目结构 | 见 §7 |
| 环境变量 | 客户端用环境变量配 BOT_WS_URL；Claude 相关全部保留 |
| 常见问题 | 新增"客户端离线"、"配对过期"等 |

---

**就这么多。问题、分歧、想改的地方都可以提。**
