# ClaudeBot — Claude Code in Microsoft Teams

在 Microsoft Teams 中跟你电脑上的 Claude Code 聊天。手机、平板、任何设备都能用。

云端 bot 永久在线（Render 免费层），关电脑也能收消息——只要客户端在跑就行。

```
┌─────────────┐   云端 bot    ┌──────────────┐    本地 client    ┌─────────────┐
│   Teams     │ ─────────────→│ Render bot   │ ←───WebSocket───→ │ Your laptop │
│ (手机/电脑) │               │ (永久在线)   │                   │ Claude Code │
└─────────────┘               └──────────────┘                   └─────────────┘
                                      ↓
                              ┌──────────────┐
                              │ Upstash Redis│  (持久化配对/会话)
                              └──────────────┘
```

---

## 三步上手

### 1. 装客户端

```bash
npm install -g claude-teams-client --registry=https://registry.npmjs.org/
```

> 公司内网默认走 MS 私有 registry，必须加 `--registry=https://registry.npmjs.org/`。

### 2. 启动客户端

```bash
claude-teams-client
```

启动后会显示一个 token，例如：

```
┌───────────────────────────────────────────────────────────────
│  Claude Teams Client
│  Token:    2ac42715-b623-4c0f-b4a8-d9b4f22f401b
│  Bot URL:  wss://teambot-mih3.onrender.com/ws
│
│  In Teams, send this command once to bind your account:
│    /pair 2ac42715-b623-4c0f-b4a8-d9b4f22f401b
│
│  After pairing, just keep this client running.
└───────────────────────────────────────────────────────────────
[client] mirror endpoint: http://127.0.0.1:47291/mirror
[client] connecting to wss://teambot-mih3.onrender.com/ws...
[client] connected, sending hello (token=2ac42715...)
```

让这个 terminal 一直开着。

### 3. 在 Teams 里配对（只做一次）

a. 安装 ClaudeBot 应用：在 Teams 里 **Apps → Manage your apps → Upload an app → Upload a custom app**，选 `appPackage/build/appPackage.teams.zip`

b. 打开 ClaudeBot 聊天，发送：
```
/pair 2ac42715-b623-4c0f-b4a8-d9b4f22f401b
```
（把 token 换成你自己的）

完成。**配对永久存在 Redis，重启 bot/client 都不用重 pair**。

---

## 两种使用场景

### 场景一：Teams → 电脑（在 Teams 里指挥 Claude）

最常用。任何设备打开 Teams 给 ClaudeBot 发消息，消息走云端 bot 转发到你电脑上的 client，由本地 Claude Code 处理后回 Teams。

```
你在 Teams 输入：帮我看看 app.ts 第 100 行有什么问题
                ↓
            （走云端）
                ↓
你电脑上的 client 收到 → 调用本地 claude → Claude 阅读文件并分析
                ↓
            （走云端）
                ↓
Teams 收到 Claude 的回复
```

#### 常用命令

| 命令 | 作用 |
|---|---|
| 任意文本 | 发给 Claude |
| `/whoami` | 查看当前配对状态 |
| `/pair <token>` | 绑定客户端（首次） |
| `/unpair` | 解除绑定 |
| `/status` | 查看 Claude 当前会话信息（消息数、成本等） |
| `/model` | 列出可用模型 |
| `/model <编号>` | 切换模型 |
| `/reset` | 清空当前会话 |
| `/compact` | 压缩上下文（节省 token） |
| `/resume` | 列出本地所有 Claude 会话 |
| `/resume <编号>` | 接管本地某个会话 |
| `/help` | 查看帮助 |

### 场景二：电脑 → Teams（镜像模式）

你**坐在电脑前直接用 Claude Code** 时，每轮对话自动同步到 Teams。出门后用手机就能看到刚才的进度，无缝接力。

#### 启用镜像

镜像按**目录**控制（白名单），避免把所有 Claude 进程都推到 Teams 干扰。

```bash
cd /your/project
claude-teams-client mirror-on
# ✓ Mirror enabled for: /your/project
```

子目录自动包含。在该目录及任何子目录里跑 `claude` 都会推送。

#### 镜像效果

电脑终端：
```
$ cd /your/project
$ claude
> 1+1=?
2
```

Teams 里同步收到：
```
[mirror] [3a7b9c12] [user] 1+1=?
[mirror] [3a7b9c12] [claude] 2
```

`[3a7b9c12]` 是 Claude session ID 前 8 位。**同一目录开多个终端**时，这个前缀帮你区分哪个回复属于哪个 terminal。

#### 镜像管理命令

```bash
claude-teams-client mirror-on    # 启用当前目录
claude-teams-client mirror-off   # 禁用当前目录
claude-teams-client mirror-list  # 查看所有启用的目录
```

白名单存在 `~/.claude-teams-client/mirror-cwds.json`。

#### 镜像 hooks 安装

镜像需要 Claude Code 的 hooks 配合。在 `~/.claude/settings.json` 加：

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "bash ~/.claude/hooks/push-prompt-to-teams.sh", "timeout": 10 }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "bash ~/.claude/hooks/push-to-teams.sh", "timeout": 10 }
        ]
      }
    ]
  }
}
```

`push-prompt-to-teams.sh` 和 `push-to-teams.sh` 在本仓库 `scripts/hooks/` 下，复制到 `~/.claude/hooks/` 即可。

---

## 客户端命令速查

```bash
claude-teams-client              # 启动客户端（默认）
claude-teams-client status       # 查看当前配置
claude-teams-client mirror-on    # 启用镜像（当前目录）
claude-teams-client mirror-off   # 禁用镜像
claude-teams-client mirror-list  # 列出镜像目录
claude-teams-client reset-token  # 重新生成 token（需重新 /pair）
claude-teams-client help         # 帮助
```

#### 环境变量

| 变量 | 用途 | 默认 |
|---|---|---|
| `BOT_WS_URL` | bot WebSocket 地址 | `wss://teambot-mih3.onrender.com/ws` |
| `CLAUDE_CLI_PATH` | claude 可执行文件路径 | `claude.cmd`(win) / `claude` |
| `CLAUDE_MODEL` | 默认模型 | `claude-opus-4-6-20250514` |
| `CLAUDE_WORKING_DIR` | Claude 工作目录 | `cwd` |
| `CLAUDE_TIMEOUT_MS` | 单条消息超时 | `300000` |
| `CLAUDE_PERMISSION_MODE` | `auto` / `acceptEdits` / `bypassPermissions` | `auto` |
| `MIRROR_PORT` | 本地 mirror 端口 | `47291` |

---

## 注意事项

- **冷启动 ~30 秒**：Render 免费层 15 分钟无请求会休眠，第一条消息可能 timeout。再发一条就好。
- **单租户限制**：bot 注册在 `0xw71` 开发者租户，目前**只有该租户用户能用**。外部公司同事接入需要升级 multi-tenant。
- **不要同时跑两个 client**：同一 token 同时连两个 client 会被互相 kick。
- **Mirror 不在白名单的目录不推**：bot 触发的 Claude 默认不会被镜像（避免循环），只有你 `mirror-on` 过的目录才会推。

---

## 给开发者：自部署 / 改代码

### 项目结构

```
teambot/
├── app.ts                  # Bot 主逻辑（Teams 消息处理 + WebSocket 中继）
├── ws-hub.ts               # WebSocket server（多 client 路由）
├── pairing-store.ts        # AAD ↔ token ↔ conversation 三向映射（Redis 持久化）
├── index.ts                # 入口
├── packages/client/        # 客户端 npm 包源码
│   └── src/
│       ├── cli.ts          # CLI 入口
│       ├── daemon.ts       # WS daemon + mirror HTTP 端点
│       └── claude-bridge.ts# 调用本地 claude CLI
└── appPackage/             # Teams app 清单
```

### 部署到 Render

1. Fork 本仓库到你的 GitHub
2. Render → New Web Service → Connect repo
3. 设置：
   - Build: `npm install && npm run build`
   - Start: `node ./dist/index.js`
   - Region: 推荐 Singapore
4. 环境变量：
   - `CLIENT_ID`, `CLIENT_SECRET`, `TENANT_ID`（你的 Bot Framework 注册）
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`（持久化）
   - `NODE_VERSION=22`
5. 在 Bot Framework Portal 把 messaging endpoint 改为 `https://你的服务.onrender.com/api/messages`

### 本地开发

```bash
npm install
npm run build
npm run dev          # 端口 3978，调试 9239
```

或一键配置（自动注册 Teams app + bot）：

```bash
npm run provision    # 调用 atk CLI 完成所有注册步骤
```

---

## 当前状态

- Bot: `https://teambot-mih3.onrender.com`
- npm: [`claude-teams-client@0.6.0`](https://www.npmjs.com/package/claude-teams-client)
- GitHub: `Userrober/teambot`
