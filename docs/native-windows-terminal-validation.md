# AgentHub Native 笔记本验证清单

本文档用于验证 `experiment/native-windows-terminal-host` 分支上的 Windows-only 原生终端方案。目标是确认新的 native 宿主是否能替代 Electron/xterm.js 终端层，让 Codex 在笔记本上具备可用的滚动、输入和 hook 回传能力。

## 验证目标

- AgentHub 可以在一个软件内打开多个 workspace。
- AgentHub 可以启动 Codex、Claude、Gemini 和普通 PowerShell/cmd session。
- 终端显示层使用 native Windows Terminal backend，而不是 Electron/xterm.js。
- 底部输入框可以控制目标 Agent 输入。
- Codex `resume` 后可以正常滚动查看历史内容。
- hook 回传可以进入 AgentHub 的 Collaboration timeline。

## 拉取分支

在笔记本仓库目录执行：

```powershell
git fetch origin
git switch experiment/native-windows-terminal-host
git pull
git status --short --branch
```

期望结果：

- 当前分支是 `experiment/native-windows-terminal-host`。
- 工作区没有未提交改动，除非你正在本机临时排障。

## 环境预检

从仓库根目录执行：

```powershell
.\scripts\start-native.ps1 -Check -Workspace V:\OrderManager -Shell powershell -Agent codex -Python "py -3.11"
.\scripts\start-native.ps1 -Check -Workspace V:\OrderManager -Shell cmd -Agent codex -Python "py -3.11"
.\scripts\start-native.ps1 -Check -Workspace V:\OrderManager -Agent powershell
.\scripts\start-native.ps1 -Check -Workspace V:\OrderManager -Agent cmd
.\scripts\publish-native.ps1 -Check
```

期望结果：

- workspace 路径存在，并且能被当前电脑访问。
- PowerShell 和 cmd host shell 能找到。
- `codex` 能在 PATH 中找到。
- `py -3.11` 能启动 Python。
- `powershell`、`cmd` 只提示使用 Host shell，不要求额外 Agent CLI。
- publish check 输出 native project、hooks 目录和发布目录。

如果第一条失败，优先检查：

```powershell
where.exe codex
py -0p
py -3.11 --version
```

## 直接运行开发版

先用 PowerShell host 验证 Codex：

```powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Shell powershell -Agent codex -Resume -Python "py -3.11"
```

再用 cmd host 验证 Codex：

```powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Shell cmd -Agent codex -Resume -Python "py -3.11"
```

也可以只启动普通 shell，确认 native 终端基本能力：

```powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Agent powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Agent cmd
```

## 发布版验证

在开发机或笔记本执行发布：

```powershell
.\scripts\publish-native.ps1
```

然后运行发布目录中的启动脚本：

```powershell
.\artifacts\native\win-x64\start-agenthub-native.bat -Workspace V:\OrderManager -Agent codex -Resume -Python "py -3.11"
```

发布版 `start-agenthub-native.bat` 直接调用 native exe。native exe 同时兼容 `-Workspace/-Agent/-Resume/-Python` 和 `--workspace/--agent/--resume/--python` 两种参数风格。

需要确认发布目录存在：

```text
artifacts/native/win-x64/AgentHub.Native.App.exe
artifacts/native/win-x64/start-agenthub-native.bat
artifacts/native/win-x64/scripts/hooks/agenthub_hook_common.py
artifacts/native/win-x64/scripts/hooks/agenthub_codex_stop.py
artifacts/native/win-x64/scripts/hooks/agenthub_claude_stop.py
artifacts/native/win-x64/scripts/hooks/agenthub_gemini_after_agent.py
```

## UI 验证点

打开 native app 后依次确认：

1. workspace 可以添加、选中和移除。
2. Host shell 默认是 PowerShell，并且可以切换到 cmd。
3. `Resume Codex` 能进入 `codex resume`。
4. Codex TUI 刚进入时是否有终端滚动条。
5. 鼠标滚轮是否能向上翻历史。
6. 触摸板双指滚动是否能向上翻历史。
7. 底部输入框按 Enter 会发送。
8. 底部输入框按 Shift+Enter 会换行，不会发送。
9. 多行输入能被 Codex 收到。
10. `@codex message` 可以路由到最新 Codex session。
11. 如果同时启动 Claude/Gemini，`@claude`、`@gemini` 可以路由到对应 session。
12. Codex 完成响应后，Collaboration timeline 是否出现 hook 回传。
13. `Stop selected` 可以停止当前 session。
14. `Stop all` 可以停止全部 session。

## 需要回传的信息

如果笔记本仍然出现滚动异常，请回传：

```powershell
git rev-parse HEAD
dotnet --info
where.exe codex
codex --version
py -0p
py -3.11 --version
.\scripts\start-native.ps1 -Check -Workspace V:\OrderManager -Shell powershell -Agent codex -Python "py -3.11"
.\scripts\start-native.ps1 -Check -Workspace V:\OrderManager -Shell cmd -Agent codex -Python "py -3.11"
```

同时说明：

- 使用的是 PowerShell host 还是 cmd host。
- 是鼠标滚轮不能滚、触摸板不能滚，还是滚动条本身不显示。
- 是刚进入 `codex resume` 就不显示，还是输出变多后才消失。
- Windows Terminal 或 VS Code 终端里同一个 `codex resume` 是否能滚动。
- AgentHub Native 状态栏最后显示的文本。
- 如果 hook 回传没有进入 timeline，请附上 `%LOCALAPPDATA%\AgentHub\Native\hooks.jsonl` 的最后几行。

## 当前已知边界

- 该分支是并行 native 原型，不替换 `desktop/` Electron 主线。
- 终端控件来自 `EasyWindowsTerminalControl`，底层使用 Windows Terminal backend / ConPTY，但不是微软官方稳定嵌入式 TerminalControl API。
- 当前项目 target framework 是 `.NET 10`。
- native app 不记录 Codex 实时原始输出；只记录用户消息、hook 回传、自动转发事件，以及 hook 诊断事件。
