# AgentHub 手动启动指南

本文档说明如何在 Windows 上从源码手动启动当前主线 Electron 版 AgentHub。

## 1. 前置条件

确认系统已安装：

- Windows 10/11
- Node.js 20+，可在 PowerShell 中执行 `node -v`
- npm，通常随 Node.js 一起安装，可执行 `npm -v`
- Python 3.11+，仅在运行 Python 参考测试或 hook 脚本测试时需要
- `codex`、`claude`、`gemini` 已加入系统 `PATH`

如果仓库位于 UNC 路径，例如 `\\10.0.0.23\code\AgentGroup`，而 `node-pty` 安装或构建失败，建议先把共享目录映射为盘符，例如 `V:\AgentGroup`，再从盘符路径运行命令。

## 2. 进入项目目录

PowerShell 示例：

```powershell
Set-Location -LiteralPath "\\10.0.0.23\code\AgentGroup"
```

如果使用映射盘符：

```powershell
Set-Location V:\AgentGroup
```

## 3. 安装 Electron 依赖

首次启动前执行：

```powershell
cd desktop
npm install
```

`npm install` 会安装 Electron、React、xterm.js、node-pty，并执行 `electron-rebuild` 重新构建 node-pty。

## 4. 启动 AgentHub

开发模式启动：

```powershell
cd desktop
npm run dev
```

启动成功后会打开 AgentHub 桌面窗口。这个 PowerShell 窗口不要关闭；关闭后 Electron 开发服务也会退出。

## 5. 启动后的基本检查

在 AgentHub 界面中：

1. 确认左上角工作区路径正确。
2. 如果需要管理其他项目，先切换到目标 workspace。
3. 在 profile 列表中启动 `Codex`、`Claude`、`Gemini`。
4. 每个 Agent 会打开独立 xterm 终端面板。
5. 中央协作消息区可以输入：

```text
@codex 实现一个小任务
@claude 帮我拆解需求
@gemini review 当前方案
```

也可以在输入框写需求后点击：

- `交给 Claude 管理`：让 Claude 作为 manager，通过结构化命令把任务派给 Codex/Gemini。
- `新建讨论`：创建 Claude -> Codex -> Gemini 的圆桌讨论，默认 2 轮，最后回到 Claude 总结。

## 6. hook 服务说明

AgentHub 启动时会自动启动本地 hook HTTP 服务，并在通过界面启动 Agent 时注入环境变量：

- `AGENTHUB_HOOK_URL`
- `AGENTHUB_HOOK_TOKEN`
- `AGENTHUB_PROFILE_ID`
- `AGENTHUB_SESSION_ID`
- `AGENTHUB_RUN_ID`
- `AGENTHUB_WORKSPACE`

因此请优先从 AgentHub 界面启动 Codex/Claude/Gemini。直接在外部终端手动启动这些 CLI 时，默认不会带上当前 AgentHub session 的环境变量，也就无法自动把结果回传到协作消息区。

## 7. 验证命令

修改代码后建议运行：

```powershell
cd desktop
npm run typecheck
npm test
npm run build
```

如果改动涉及 Python 参考实现或 hook 脚本，再运行：

```powershell
python -m pytest -v
```

## 8. 常见问题

### `node-pty` 安装失败

优先使用映射盘符运行项目，避免 UNC 路径触发构建问题。

### 启动后 Agent hook 不回传消息

检查 Agent 是否从 AgentHub 界面启动，而不是从外部终端启动。也可以在 Agent 终端中检查：

```powershell
Get-ChildItem Env:AGENTHUB_*
```

至少应看到 `AGENTHUB_HOOK_URL`、`AGENTHUB_HOOK_TOKEN`、`AGENTHUB_PROFILE_ID`、`AGENTHUB_SESSION_ID`、`AGENTHUB_RUN_ID`、`AGENTHUB_WORKSPACE`。

### 切换 workspace 失败

只要有写入型 Agent session 在线，AgentHub 会阻止切换 workspace。先停止相关 Agent，再切换目录。

### 端口或窗口没有起来

关闭旧的 `npm run dev` PowerShell 窗口后重启：

```powershell
cd desktop
npm run dev
```

