# TeamBot — Claude Code x Teams Bridge

在 Microsoft Teams 中与 Claude Code 交互。手机上发消息就能控制电脑上的 Claude Code 写代码。

## 两种使用场景

### 场景一：终端镜像（Terminal → Teams 推送）

在电脑终端使用 Claude Code 时，对话内容实时同步到 Teams。适合离开电脑后用手机查看 Claude 的工作进度。

```bash
# 在终端启动镜像
teambot connect

# 之后在终端正常使用 Claude Code，所有对话自动推送到 Teams
claude
> 帮我写一个登录页面
# → Teams 上实时看到 Claude 的回复

# 停止镜像
teambot disconnect
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
teambot handoff

# 之后可以退出终端，Teams 完全接管
# 在 Teams 里继续发消息即可
```

**取回到终端：**

```bash
teambot takeback
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
- **Session 共享** — 通过 resume/handoff/takeback 在终端和 Teams 间切换同一个 Claude 会话
- **命令系统** — `/help` `/reset` `/status` `/model` `/compact` `/resume` 等

## 前置条件

- [Node.js](https://nodejs.org/) 20+
- Microsoft 365 账号（有 Teams 权限）
  > **注意**：企业内部账号（如 intern 账号）可能没有在 [Teams Developer Portal](https://dev.teams.microsoft.com/) 注册 Bot 的权限。实测 [M365 开发者账号](https://developer.microsoft.com/microsoft-365/dev-program)（免费申请）可以成功注册。

以下依赖会在首次运行 `teambot` 时自动安装：
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- [Dev Tunnel CLI](https://learn.microsoft.com/azure/developer/dev-tunnels/)

## 完整搭建流程

### 第一步：注册 Bot（一次性）

在 [Teams Developer Portal](https://dev.teams.microsoft.com/bots) 注册：

1. 点击 "+ New Bot" → 输入名称 → "Add"
2. 进入 "Client secrets" → "Add a client secret" → 复制密码
3. 复制页面顶部的 Bot ID
4. 获取 Tenant ID：[Azure Portal](https://portal.azure.com/) > Azure Active Directory > Overview

### 第二步：安装并启动

```bash
npm install -g teambot
teambot
```

首次运行会自动：
1. 检测并安装缺失的依赖（Claude CLI、Dev Tunnel CLI）
2. 引导 Dev Tunnel 登录
3. 交互式收集 Bot ID、Client Secret、Tenant ID
4. 创建 Dev Tunnel
5. 打包 Teams App zip
6. 启动 Bot 服务

### 第三步：配置 Bot Endpoint

在 [Teams Developer Portal](https://dev.teams.microsoft.com/bots) 的 Bot 设置中：
- 设置 Endpoint address 为 `teambot` 输出的 Tunnel URL + `/api/messages`
- 例如：`https://xxxxx-3978.asse.devtunnels.ms/api/messages`

### 第四步：上传 Teams App

1. 打开 Teams → 应用 → 管理你的应用 → 上传自定义应用
2. 选择 `~/.teambot/appPackage/appPackage.zip`
3. 安装到个人或团队

### 第五步：开始使用

在 Teams 中找到你的 Bot，发一条消息。如果一切正常，Claude 会回复。

## 每日使用

```bash
# 启动（配置已保存，直接启动）
teambot

# 停止
teambot stop

# 重新配置
teambot config
```

### 终端镜像

```bash
# 启动镜像 — 终端对话自动同步到 Teams
teambot connect

# 停止镜像
teambot disconnect
```

### Session 共享（Handoff/Takeback）

让 Teams 和终端共享同一个 Claude 上下文。共享后在 Teams 发消息，Claude 能看到终端的完整对话历史。

**共享给 Teams：**
```bash
teambot handoff
```

共享后终端和 Teams 都可以使用，但不要同时发消息（避免 session 冲突）。

**取回到终端：**
```bash
teambot takeback
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

## CLI 命令

| 命令 | 说明 |
|------|------|
| `teambot` | 配置（首次）并启动 Bot |
| `teambot stop` | 停止 Bot |
| `teambot config` | 重新配置 |
| `teambot connect` | 连接终端镜像 |
| `teambot disconnect` | 断开终端镜像 |
| `teambot handoff` | 移交 Claude session 给 Teams |
| `teambot takeback` | 从 Teams 取回 Claude session |
| `teambot help` | 显示帮助 |

## 工作原理

```
Teams 用户发消息 → Bot 收到 → 调用 claude -p CLI → Claude 回复 → Bot 发回 Teams
```

每次消息使用 `claude -p --resume <sessionId>` 保持会话连续。

终端镜像通过 Claude Code hooks（Stop / UserPromptSubmit）将终端对话推送到 Bot，再转发到 Teams。

## 项目结构

```
teambot/
├── bin/
│   └── teambot.js        # CLI 入口
├── index.ts              # 入口
├── app.ts                # Bot 主逻辑
├── claude-bridge.ts      # Claude CLI 进程管理
├── claude-types.ts       # TypeScript 类型
├── config.ts             # 环境变量配置
├── session-store.ts      # 会话状态持久化
├── scripts/
│   ├── setup.sh          # 一键安装（开发用）
│   ├── provision.js      # 自动化配置
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

最常见的原因是缺少 `TENANT_ID`。Bot 注册为 Single Tenant 类型时，SDK 必须用你的 Tenant ID 获取 token。运行 `teambot config` 重新配置，确保三个凭据都填写正确。

**Q: listen EADDRINUSE: address already in use :::3978？**

端口被占用，先停掉旧进程再启动：
```bash
teambot stop
teambot
```

**Q: Teams 发消息没有回复？**
1. 检查 Bot 是否在运行：`curl http://localhost:3978/api/messages`
2. 检查 Dev Tunnel 是否连通：查看 `~/.teambot/.tunnel.log`
3. Tunnel 可能断了，运行 `teambot stop && teambot` 重启

**Q: 回复很慢？**

Teams 模式下有 2-5 秒延迟，是 Dev Tunnel 导致的，属于正常现象。

**Q: Handoff 后 Teams 报错？**

不要同时从终端和 Teams 发消息。等一边回复完再从另一边发。如果冲突了，运行 `teambot stop && teambot` 重启。

**Q: 如何切换模型？**

在 Teams 中发送 `/model` 查看列表，`/model 2` 切换。

**Q: Tunnel 过期了？**

Dev Tunnel 有时效限制，过期后重启即可，`teambot` 会自动创建新 tunnel：
```bash
teambot stop
teambot
```
然后在 Teams Developer Portal 更新 Bot 的 messaging endpoint。
