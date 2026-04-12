# TeamBot — Claude Code × Teams Bridge

在 Microsoft Teams 中与 Claude Code 交互。支持两种模式：

- **Playground 模式** — 本地浏览器中使用，零配置
- **Teams 模式** — 在 Teams 客户端中使用，支持手机访问

## 功能

- **Teams 独立对话** — 在 Teams/Playground 中直接与 Claude 对话，Claude 可以读写代码、执行命令
- **终端镜像** — 你在终端中与 Claude Code 的对话实时同步显示在 Teams 中
- **命令系统** — `/help` `/reset` `/status` `/model` `/compact` 等命令

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org/) 20 或更高版本
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
  ```bash
  npm install -g @anthropic-ai/claude-code
  ```
- 有效的 Claude API 密钥（Claude Code 已配置好）

### 安装

```bash
git clone <repo-url>
cd teambot
npm run setup
```

`npm run setup` 会自动完成：
- 安装项目依赖
- 安装 M365 Agents Playground CLI
- 配置 Claude Code hooks（用于终端镜像）

### 使用

#### 启动

在你的 Claude Code 终端中执行：

```bash
npm run connect
```

或者：

```bash
! bash scripts/connect-teams.sh
```

这会自动启动 Bot 服务和 Playground，打开浏览器访问 **http://localhost:56150** 即可使用。

#### 停止镜像

```bash
npm run disconnect
```

终端镜像停止，但 Bot 和 Playground 继续运行，Teams 中仍可独立对话。

### 在 Teams 中可用的命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/reset` | 重置 Claude 会话，重新开始 |
| `/status` | 显示当前会话状态（消息数、费用等） |
| `/model` | 查看当前模型和可选列表 |
| `/model <编号或名称>` | 切换模型，如 `/model 2` 或 `/model sonnet` |
| `/compact` | 压缩对话上下文 |
| `/bind <session>` | 绑定到一个终端的 Claude 会话（高级用法） |
| `/unbind` | 解除绑定 |
| `/diag` | 显示调试信息 |

## Teams 客户端模式（可选）

如果你想在 Teams 客户端（包括手机）中使用，需要额外配置。

### 前置条件

- Microsoft 365 开发者账号（[免费申请](https://developer.microsoft.com/microsoft-365/dev-program)）
- 组织的 Teams 管理员权限（用于上传自定义 App）
- [Dev Tunnel CLI](https://learn.microsoft.com/azure/developer/dev-tunnels/)
  ```bash
  winget install Microsoft.devtunnel
  ```

### 一次性配置

#### 1. 登录 Dev Tunnel

```bash
devtunnel user login
```

#### 2. 创建 Tunnel

```bash
devtunnel create --allow-anonymous
devtunnel port create -p 3978
```

记下输出的 tunnel URL（类似 `https://xxxxx-3978.jpe1.devtunnels.ms`）。

#### 3. 注册 Bot

使用 VS Code 的 M365 Agents Toolkit 扩展进行 provision，或手动在 [Bot Framework](https://dev.botframework.com/bots) 注册：

- Messaging endpoint: `https://<your-tunnel-url>/api/messages`
- 记下 `CLIENT_ID` 和 `CLIENT_SECRET`

#### 4. 配置环境变量

编辑 `.localConfigs`：

```
PORT=3978
CLIENT_ID=<your-bot-id>
CLIENT_SECRET=<your-bot-secret>
TENANT_ID=<your-tenant-id>
```

#### 5. 打包上传 Teams App

在 `appPackage/manifest.json` 中替换 `${{BOT_ID}}` 和 `${{TEAMS_APP_ID}}`，然后打包为 zip 上传到 Teams。

### 使用 Teams 模式

```bash
# 1. 启动 tunnel
devtunnel host

# 2. 在另一个终端启动 Bot
source .localConfigs && PORT=3978 npx ts-node ./index.ts

# 3. 在 Claude Code 终端连接镜像
npm run connect
```

在 Teams 中找到你的 Bot，发消息即可。

## 工作原理

### Teams 独立对话

```
Teams 用户发消息 → Bot 收到 → 调用 claude -p CLI → Claude 回复 → Bot 发回 Teams
```

每次消息 spawn 一个新的 CLI 进程，通过 `--resume` 共享会话历史，对话连续。

### 终端镜像

```
终端用户输入 → UserPromptSubmit hook → Bot /api/push → Teams 显示
终端 Claude 回复 → Stop hook → Bot /api/push → Teams 显示
```

镜像消息带前缀区分：
- `📝 Terminal User:` — 终端用户的输入
- `🤖 Terminal Claude:` — 终端 Claude 的回复

### 两种模式对比

| | Playground 模式 | Teams 客户端模式 |
|---|---|---|
| 访问方式 | 本地浏览器 localhost:56150 | Teams 客户端（含手机） |
| 配置难度 | 零配置 | 需要 Bot 注册 + tunnel |
| 稳定性 | 非常稳定 | 取决于 tunnel |
| 延迟 | 几乎无 | 2-5 秒 |
| 多人使用 | 仅本人 | 组织内可共享 |

## 项目结构

```
teambot/
├── index.ts              # 入口
├── app.ts                # Bot 主逻辑
├── claude-bridge.ts      # Claude CLI 调用管理
├── claude-types.ts       # TypeScript 类型
├── config.ts             # 环境变量配置
├── session-store.ts      # 会话状态管理
├── scripts/
│   ├── setup.sh          # 一键安装
│   ├── connect-teams.sh  # 启动并连接
│   ├── disconnect-teams.sh # 断开连接
│   ├── push-to-teams.sh  # Stop hook
│   └── push-prompt-to-teams.sh # UserPromptSubmit hook
├── appPackage/           # Teams App 包
└── infra/                # Azure 部署模板（可选）
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | Bot 端口 | `3978` |
| `CLAUDE_CLI_PATH` | Claude CLI 路径 | `claude` |
| `CLAUDE_MODEL` | 模型 | `claude-opus-4-6-20250514` |
| `CLAUDE_WORKING_DIR` | CLI 工作目录 | 当前目录 |
| `CLAUDE_TIMEOUT_MS` | 超时（毫秒） | `120000` |
| `CLAUDE_MAX_BUDGET_USD` | 单次最大费用 | `1.0` |
| `CLAUDE_SKIP_PERMISSIONS` | 跳过权限确认 | `true` |

## 常见问题

**Q: Teams 发消息没有回复？**
检查 Bot 是否在运行（`curl http://localhost:3978/api/inbox -X POST -H "Content-Type: application/json" -d '{"session_id":"x"}'`），以及 tunnel 是否连通。

**Q: 终端镜像消息重复？**
确保只有一个终端执行了 `connect-teams.sh`。

**Q: Claude 回复很慢？**
Teams 模式下延迟是 tunnel 导致的，属于正常现象。Playground 模式无延迟。

**Q: 如何切换模型？**
在 Teams/Playground 中发送 `/model` 查看列表，`/model 2` 切换。
