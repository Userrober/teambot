# TeamBot — Claude Code x Teams Bridge

在 Microsoft Teams 中与 Claude Code 交互。手机上发消息就能控制电脑上的 Claude Code 写代码。

## 两种使用场景

### 场景一：终端镜像（Terminal → Teams 推送）

在电脑终端使用 Claude Code 时，对话内容实时同步到 Teams。适合离开电脑后用手机查看 Claude 的工作进度。

```bash
# 在终端启动镜像
npm run connect

# 之后在终端正常使用 Claude Code，所有对话自动推送到 Teams
claude
> 帮我写一个登录页面
# → Teams 上实时看到 Claude 的回复

# 停止镜像
npm run disconnect
```

启动后终端的每一轮对话（你的提问 + Claude 的回复）都会自动出现在 Teams 的 Bot 聊天里。

### 场景二：Session 共享（Teams ↔ Terminal）

在 Teams 中直接接管终端的 Claude Code 会话，共享完整上下文。适合在手机上继续电脑上的工作。

**方式 A：在 Teams 中选择本地 session**

```
# 在 Teams 发送，列出电脑上所有 Claude Code 会话：
/resume

# Bot 返回：
# 1. `209ddf7d-da21-461a-bba9-b29dc933d32e` — 04/15 14:35 — 12 msgs — 帮我写一个登录页面
# 2. `a1b2c3d4-e5f6-7890-abcd-ef1234567890` — 04/15 10:20 — 5 msgs — Fix the API endpoint

# 按编号选择：
/resume 1

# 或用完整 session ID：
/resume 209ddf7d-da21-461a-bba9-b29dc933d32e

# 绑定后，Teams 发消息就和终端共享同一个 Claude 上下文
你好，继续刚才的工作，把登录页面加上表单验证
# → Claude 能看到之前终端里的完整对话历史
```

**方式 B：从终端 Handoff 给 Teams**

```bash
# 在 Claude Code 终端中执行：
! bash scripts/handoff.sh

# 之后可以退出终端，Teams 完全接管
# 在 Teams 里继续发消息即可
```

**取回到终端：**

```bash
bash scripts/takeback.sh
claude --resume <session-id>
```

**其他常用 Teams 命令：**

```
/status    # 查看当前 session 信息（ID、消息数、费用、最后活动时间）
/model     # 查看/切换模型（如 /model opus, /model 2）
/compact   # 压缩上下文，减少 token 占用
/reset     # 重置会话，开始全新对话
/help      # 显示所有命令
```

## 功能

- **Teams 对话** — 在 Teams 中直接与 Claude 对话，Claude 可以读写代码、执行命令
- **终端镜像** — 终端中与 Claude Code 的对话实时同步到 Teams
- **Session 共享** — 通过 handoff/takeback 在终端和 Teams 间切换同一个 Claude 会话
- **命令系统** — `/help` `/reset` `/status` `/model` `/compact` 等

## 前置条件

在开始之前，确保你有以下工具和账号：

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
  > **注意**：企业内部账号（如 intern 账号）可能没有在 [Teams Developer Portal](https://dev.teams.microsoft.com/) 注册 Bot 的权限。实测 [M365 开发者账号](https://developer.microsoft.com/microsoft-365/dev-program)（免费申请）可以成功注册。

## 完整搭建流程

### 第一步：克隆并安装

```bash
git clone https://github.com/Userrober/teambot.git
cd teambot
npm run setup
```

`npm run setup` 会自动完成：
- 检查前置条件（Node.js、Claude CLI、Dev Tunnel）
- 安装项目依赖
- 构建 TypeScript
- 配置 Claude Code hooks（用于终端镜像）

### 第二步：一键配置（Dev Tunnel + Bot 注册 + 打包）

运行配置向导，它会引导你完成所有一次性设置：

```bash
node scripts/configure.js
```

向导会自动引导你完成：
1. **检测/创建 Dev Tunnel** — 自动获取 tunnel URL
2. **打开 Teams Developer Portal** — 引导你注册 Bot、创建 Client Secret
3. **打开 Bot Framework Portal** — 引导你获取 Tenant ID
4. **填写凭证** — 输入 CLIENT_ID、CLIENT_SECRET、TENANT_ID
5. **生成配置文件** — 自动创建 `.localConfigs`
6. **打包 Teams App** — 自动生成 `appPackage/build/appPackage.zip`

> **需要拿到的三个值**：`CLIENT_ID`（Bot ID，创建 Bot 时自动生成）、`CLIENT_SECRET`（在 Bot 页面的 Client secrets 中手动创建，只显示一次）、`TENANT_ID`（在 [Bot Framework Portal](https://dev.botframework.com/bots) → Bot Settings 中的 App Tenant ID）。缺少任何一个都会导致 401 错误。

### 第三步：上传 Teams App

1. 打开 Teams → 应用 → 管理你的应用 → 上传自定义应用
2. 选择 `appPackage/build/appPackage.zip`
3. 安装到个人或团队

### 第四步：启动并测试

```bash
npm run start:teams
```

在 Teams 中找到你的 Bot，发一条消息。如果一切正常，Claude 会回复。

> **注意**：必须用 `npm run start:teams` 启动，这个命令会自动加载 `.localConfigs` 的环境变量并启动 Dev Tunnel。直接用 `npm run dev` 启动不会加载配置文件。

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
| `/resume` | 列出本地 Claude Code 会话 |
| `/resume <编号或ID>` | 绑定到指定 Claude 会话 |
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
│   ├── start.js          # 启动 tunnel + Bot
│   ├── stop.js           # 停止所有进程
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
| `CLIENT_ID` | Bot App ID | 必填 |
| `CLIENT_SECRET` | Bot App 密钥 | 必填 |
| `TENANT_ID` | Azure AD 租户 ID | 必填 |
| `CLAUDE_CLI_PATH` | Claude CLI 路径 | `claude` |
| `CLAUDE_MODEL` | 模型 | `claude-opus-4-6-20250514` |
| `CLAUDE_WORKING_DIR` | CLI 工作目录 | 当前目录 |
| `CLAUDE_TIMEOUT_MS` | 超时（毫秒，0=无限制） | `300000` |
| `CLAUDE_MAX_BUDGET_USD` | 单次最大费用（0=无限制） | `0` |
| `CLAUDE_PERMISSION_MODE` | 权限模式（auto/acceptEdits/bypassPermissions） | `auto` |

## 常见问题

**Q: 401 Authorization has been denied for this request？**

最常见的原因是 `.localConfigs` 缺少 `TENANT_ID`。Bot 注册为 Single Tenant 类型时，SDK 必须用你的 Tenant ID 获取 token。检查 `.localConfigs` 确保 `CLIENT_ID`、`CLIENT_SECRET`、`TENANT_ID` 三个都有。

**Q: listen EADDRINUSE: address already in use :::3978？**

端口被占用，先停掉旧进程再启动：
```bash
npm run stop && npm run start:teams
```

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
