# TeamBot — Claude Code × Teams Bridge

在 Microsoft Teams 中与 Claude Code 交互。手机上发消息就能控制电脑上的 Claude Code 写代码。

## 功能

- **Teams 对话** — 在 Teams 中直接与 Claude 对话，Claude 可以读写代码、执行命令
- **终端镜像** — 终端中与 Claude Code 的对话实时同步到 Teams
- **Session 共享** — 通过 handoff/takeback 在终端和 Teams 间切换同一个 Claude 会话
- **命令系统** — `/help` `/reset` `/status` `/model` `/compact` 等

## 前置条件

- [Git for Windows](https://git-scm.com/download/win)（包含 Git Bash，脚本需要 bash 环境）
- [Node.js](https://nodejs.org/) 20+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
  ```bash
  npm install -g @anthropic-ai/claude-code
  ```
- 有效的 Claude API 密钥（已在 Claude Code 中配置）
- [Dev Tunnel CLI](https://learn.microsoft.com/azure/developer/dev-tunnels/)
  ```bash
  winget install Microsoft.devtunnel
  ```
- Microsoft 365 账号（有 Teams 权限）
  > **注意**：企业内部账号（如 intern 账号）可能没有注册 Bot 的权限。实测 [M365 开发者账号](https://developer.microsoft.com/microsoft-365/dev-program)（免费申请）可以成功注册。

## 快速上手（完整流程）

以下是从零到可用的完整步骤：

```bash
# 1. 克隆并安装
git clone https://github.com/Userrober/teambot.git
cd teambot
npm run setup

# 2. 一次性配置（详见下方"一次性 Teams 配置"）
devtunnel user login
devtunnel create --allow-anonymous
devtunnel port create -p 3978
# 注册 Bot、配置 .localConfigs、上传 Teams App

# 3. 每次使用 — 启动
npm run start:teams

# 4. 在 Teams 里找到你的 Bot，发消息即可

# 5. 共享终端上下文（可选）
# 在 Claude Code 终端里执行：
! bash scripts/handoff.sh

# 6. 取回终端
bash scripts/takeback.sh
claude --resume <session-id>

# 7. 停止
npm run stop
```

## 安装

```bash
git clone <repo-url>
cd teambot
npm run setup
```

`npm run setup` 会自动完成：
- 检查前置条件（Node.js、Claude CLI、Dev Tunnel）
- 安装项目依赖
- 构建 TypeScript
- 配置 Claude Code hooks（用于终端镜像）

## 一次性 Teams 配置

首次使用需要完成以下配置（只需做一次）：

### 1. 登录 Dev Tunnel

```bash
devtunnel user login
```

### 2. 创建 Tunnel

```bash
devtunnel create --allow-anonymous
devtunnel port create -p 3978
```

记下 tunnel ID（如 `quick-ant-8c3x1kp`）。

### 3. 获取 Tunnel URL

```bash
devtunnel host <tunnel-id>
```

记下输出的 URL（如 `https://xxxxx-3978.asse.devtunnels.ms`），然后 Ctrl+C 停止。

### 4. 注册 Bot

在 [Bot Framework Portal](https://dev.botframework.com/bots) 注册（需要 M365 开发者账号）：

1. 点击 Create a bot
2. 注册 Microsoft App ID（会跳转到 Azure Portal 创建 App registration）
3. 记下 `Application (client) ID` 和创建一个 `Client secret`
4. Messaging endpoint: `https://<your-tunnel-url>/api/messages`
5. 添加 Teams channel

### 5. 配置环境变量

在项目根目录创建 `.localConfigs`：

```
PORT=3978
CLIENT_ID=<your-bot-client-id>
CLIENT_SECRET=<your-bot-client-secret>
TENANT_ID=<your-tenant-id>
```

### 6. 上传 Teams App

1. 编辑 `appPackage/manifest.json`，替换 `${{BOT_ID}}` 为你的 Client ID
2. 将 `appPackage/` 目录打包为 zip
3. 在 Teams 管理中心或 Teams 客户端中上传自定义 App

## 每日使用

### 启动

```bash
npm run start:teams
```

自动启动 Dev Tunnel 和 Bot 服务。然后在 Teams 中找到你的 Bot 发消息即可。

### 停止

```bash
npm run stop
```

### 终端镜像

在 Claude Code 终端中执行：

```bash
npm run connect
```

终端中与 Claude 的对话会自动同步到 Teams。

停止镜像：

```bash
npm run disconnect
```

### Session 共享（Handoff/Takeback）

让 Teams 和终端共享同一个 Claude 上下文。共享后在 Teams 发消息，Claude 能看到终端的完整对话历史。

**共享给 Teams：**
```bash
# 在 Claude Code 终端中执行
! bash scripts/handoff.sh
```

共享后终端和 Teams 都可以使用，但不要同时发消息（避免 session 冲突）。

如果你要离开电脑，可以退出终端（`/exit`），Teams 会完全接管。

Teams 中发消息将使用终端的 Claude session，共享完整上下文。

**取回到终端：**
```bash
bash scripts/takeback.sh
# 然后恢复终端
claude --resume <session-id>
```

## Teams 命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/reset` | 重置 Claude 会话 |
| `/status` | 显示当前会话状态 |
| `/model` | 查看当前模型和可选列表 |
| `/model <编号或名称>` | 切换模型 |
| `/compact` | 压缩对话上下文 |
| `/bind <session>` | 绑定到终端 Claude 会话 |
| `/unbind` | 解除绑定 |
| `/diag` | 调试信息 |

## 工作原理

```
Teams 用户发消息 → Bot 收到 → 调用 claude -p CLI → Claude 回复 → Bot 发回 Teams
```

每次消息使用 `claude -p --resume <sessionId>` 保持会话连续。

终端镜像通过 Claude Code hooks（Stop / UserPromptSubmit）将终端对话推送到 Bot，再转发到 Teams。

## 项目结构

```
teambot/
├── index.ts              # 入口
├── app.ts                # Bot 主逻辑
├── claude-bridge.ts      # Claude CLI 进程管理
├── claude-types.ts       # TypeScript 类型
├── config.ts             # 环境变量配置
├── session-store.ts      # 会话状态持久化
├── scripts/
│   ├── setup.sh          # 一键安装
│   ├── start.sh          # 启动 tunnel + Bot
│   ├── stop.sh           # 停止所有进程
│   ├── connect-teams.sh  # 连接终端镜像
│   ├── disconnect-teams.sh # 断开镜像
│   ├── handoff.sh        # 移交 session 给 Teams
│   └── takeback.sh       # 取回 session 到终端
├── appPackage/           # Teams App 打包
└── infra/                # Azure 部署模板（可选）
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | Bot 端口 | `3978` |
| `CLAUDE_CLI_PATH` | Claude CLI 路径 | `claude` |
| `CLAUDE_MODEL` | 模型 | `claude-opus-4-6-20250514` |
| `CLAUDE_WORKING_DIR` | CLI 工作目录 | 当前目录 |
| `CLAUDE_TIMEOUT_MS` | 超时（毫秒，0=无限制） | `300000` |
| `CLAUDE_MAX_BUDGET_USD` | 单次最大费用（0=无限制） | `0` |
| `CLAUDE_SKIP_PERMISSIONS` | 跳过权限确认 | `true` |

## 常见问题

**Q: Teams 发消息没有回复？**
1. 检查 Bot 是否在运行：`curl http://localhost:3978/api/messages`
2. 检查 Dev Tunnel 是否连通：查看 `.tunnel.log`
3. Tunnel 可能断了，运行 `npm run stop && npm run start:teams` 重启

**Q: 回复很慢？**
Teams 模式下有 2-5 秒延迟，是 Dev Tunnel 导致的，属于正常现象。

**Q: Handoff 后 Teams 报错？**
不要同时从终端和 Teams 发消息。等一边回复完再从另一边发。如果冲突了，运行 `npm run stop && npm run start:teams` 重启。

**Q: 如何切换模型？**
在 Teams 中发送 `/model` 查看列表，`/model 2` 切换。

**Q: Tunnel 过期了？**
Dev Tunnel 有时效限制，过期后需要重新创建：
```bash
devtunnel create --allow-anonymous
devtunnel port create -p 3978
```
然后更新 Bot Framework 中的 messaging endpoint。
