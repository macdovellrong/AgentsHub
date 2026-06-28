# AgentHub Native

这是 C2 方向的 Windows-only 原生原型：AgentHub 保留 Agent session 控制权，同时把终端显示层替换成基于 Windows Terminal 后端的 WPF 控件。

## 技术栈

- C# / .NET 10
- WPF
- EasyWindowsTerminalControl
- Windows Terminal backend / ConPTY
- 默认 PowerShell host，可在界面切换为 cmd

## 运行

推荐从仓库根目录启动：

```powershell
.\start-agenthub-native.bat
```

或使用 PowerShell 脚本：

```powershell
.\scripts\start-native.ps1
```

启动时直接加入并选中某个 workspace：

```powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager
.\start-agenthub-native.bat -Workspace V:\OrderManager
```

启动时直接打开某个 Agent；`-Resume` 仅对 Codex 生效：

```powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Agent codex -Resume
.\start-agenthub-native.bat -Workspace V:\OrderManager -Agent codex -Resume
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Agent claude
```

也可以一次启动多个 Agent，按列表顺序启动；`-Resume` 仍只影响 Codex：

```powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Agent codex,claude,gemini -Resume
.\start-agenthub-native.bat -Workspace V:\OrderManager -Agent codex,claude,gemini -Resume
```

启动时指定 Host shell：

```powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Shell powershell -Agent codex -Resume
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Shell cmd -Agent codex
```

启动时指定 Agent hook 使用的 Python 命令；未指定时默认使用 `py -3`：

```powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Agent codex -Resume -Python "C:\Program Files\Python311\python.exe"
.\start-agenthub-native.bat -Workspace V:\OrderManager -Agent codex -Resume -Python "py -3.11"
```

只检查环境和路径、不启动 UI：

```powershell
.\scripts\start-native.ps1 -Check
.\scripts\start-native.ps1 -Check -Agent codex -Python "py -3.11"
.\scripts\start-native.ps1 -Check -Agent codex,claude,gemini -Python "py -3.11"
```

`-Check` 带 `-Agent` 时会检查对应的 Agent CLI 是否在 PATH 中。只有 `codex`、`claude`、`gemini` 这类需要安装 hook 的 Agent 会检查默认 hook Python 命令 `py -3`；如果传入 `-Python`，则始终检查指定命令是否能启动 Python。

## 发布

在开发机生成可复制到其他 Windows 电脑的发布目录：

```powershell
.\scripts\publish-native.ps1
```

默认输出到 `artifacts/native/win-x64`，并复制 Agent hook 脚本到发布目录内的 `scripts/hooks`。发布后可以在目标电脑运行：

```powershell
.\artifacts\native\win-x64\start-agenthub-native.bat -Workspace V:\OrderManager -Agent codex -Resume
```

只检查发布环境、不执行发布：

```powershell
.\scripts\publish-native.ps1 -Check
```

也可以直接运行项目：

```powershell
cd native/AgentHub.Native
dotnet run --project src/AgentHub.Native.App/AgentHub.Native.App.csproj
```

## 当前流程

1. 启动 native app。
2. 输入已存在的 workspace 路径并点击 Add，或点击 Browse 选择目录并加入工作区列表；如果列表中已有选中项，输入框或 Browse 新选中的路径会优先生效。
   Remove 会优先删除列表中选中的 workspace，选中项为空时才使用输入框路径。
3. app 会在该 workspace 的 `.gitignore` 中幂等加入 `.agenthub/`、`.codex/`、`.claude/`、`.gemini/`。
4. 选中 workspace 后选择 Host shell，默认 PowerShell，也可以切换为 cmd。
5. 启动 Codex、Claude、Gemini 或普通 shell session。
6. 对托管 Agent，app 会安装项目级 `.codex`、`.claude`、`.gemini` hooks。
7. app 会启动本地 hook receiver，并向 PowerShell/cmd-hosted session 注入 `AGENTHUB_HOOK_*` 环境变量。
8. 可以用底部输入栏向选中的 terminal session 发送文本；Enter 发送，Shift+Enter 在输入框内换行。多行文本会用 bracketed paste 写入终端，再发送 Enter。
9. 也可以在输入栏左侧选择 `codex`、`claude`、`gemini`、`powershell` 或 `cmd`，按列表中选中的 workspace/profile 路由到最新 session；没有选中 workspace 时才使用输入框路径。
10. 输入栏支持 `@codex message`、`@claude message`、`@gemini message`、`@powershell message`、`@cmd message` 直接定向发送，定向消息正文可以是多行。
11. Agent hook 回传如果包含 `<agenthub>{"action":"send_message","to":"codex","message":"..."}</agenthub>`、旧格式 `<agenthub>{"action":"send","target":"codex","task_id":"T-001","message":"..."}</agenthub>`，或任务计划路由命令 `assign_task` / `reject_task` / `request_review`，native app 会按当前 workspace 路由到目标 profile 的最新 session。
12. 用户发送的消息、hook 回传，以及 AgentHub 从 hook 命令自动转发给目标 Agent 的消息都会显示在 Collaboration timeline 列表中。
13. 可以用 Stop selected 停止当前 session，也可以用 Stop all 停止全部 session。

workspace 列表保存位置：

```text
%LOCALAPPDATA%\AgentHub\Native\workspaces.json
```

协作时间线保存位置：

```text
%LOCALAPPDATA%\AgentHub\Native\events
```

Host shell 等本机设置保存位置：

```text
%LOCALAPPDATA%\AgentHub\Native\settings.json
```

## 笔记本 Codex 验证

1. 启动 AgentHub Native。
2. 添加并选择出现滚动问题的项目目录。
3. Host shell 先保持默认 PowerShell。
4. 点击 Resume Codex，直接启动 `codex resume`。
5. 等待 Codex 进入恢复后的 TUI。
6. 验证终端滚动条是否出现。
7. 验证鼠标滚轮 / 触摸板滚动。
8. 从 AgentHub 输入栏发送文本，并验证 Enter 发送、Shift+Enter 换行。
9. 验证 Codex 收到输入。
10. 让 Codex 完成一次响应，确认 Collaboration timeline 列表出现回传。
11. 切换 Host shell 为 cmd 后重复第 4-10 步。

## 注意

- 这是并行原型，不替换现有 Electron app。
- `EasyWindowsTerminalControl` 使用 Windows Terminal 后端包，但仍是第三方封装，不是微软正式稳定的嵌入式 TerminalControl API。
- 当前 target framework 是 `.NET 10`。其他电脑运行前需要安装 .NET 10 Desktop Runtime，或后续改成目标机器已安装的 framework。
