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

推荐先跑一键验证脚本：

```powershell
.\scripts\validate-native-laptop.ps1 -Workspace V:\OrderManager -Python "py -3.11"
.\scripts\validate-native-laptop.ps1 -Workspace V:\OrderManager -Agent agents -Python "py -3.11"
```

源码版脚本默认验证 Codex；传入 `-Agent agents` 时会验证 Codex、Claude、Gemini。源码版会依次执行 PowerShell/Agent 预检、cmd/Agent 预检、`scrolltest` 预检，并生成诊断报告。发布包版脚本位于 `artifacts/native/win-x64/validate-native-laptop.ps1`，会检查包文件、workspace 路径、PowerShell/cmd host、所选 Agent native launcher、Codex `--no-alt-screen` 和 hook Python，再生成诊断报告。即使某个预检失败，也会继续生成报告；最近一次报告路径会写入 `artifacts/native-diagnostics/latest-laptop-validation.txt`。

从仓库根目录执行：

```powershell
.\scripts\start-native.ps1 -Check -Workspace V:\OrderManager -Shell powershell -Agent codex -Python "py -3.11"
.\scripts\start-native.ps1 -Check -Workspace V:\OrderManager -Shell cmd -Agent codex -Python "py -3.11"
.\scripts\start-native.ps1 -Check -Workspace V:\OrderManager -Agent powershell
.\scripts\start-native.ps1 -Check -Workspace V:\OrderManager -Agent cmd
.\scripts\start-native.ps1 -Check -Workspace V:\OrderManager -Agent scrolltest
.\scripts\publish-native.ps1 -Check
```

期望结果：

- workspace 路径存在，并且能被当前电脑访问。
- PowerShell 和 cmd host shell 能找到。
- `codex` 能以 Windows native launcher 形式在 PATH 中找到（`.com`、`.exe`、`.bat`、`.cmd`；npm 安装通常应显示 `codex.cmd` 而不是 `codex.ps1`），并且该 launcher 的 `--help` 包含 `--no-alt-screen`。如果这里失败，先升级 Codex CLI 或检查 npm shim 是否完整。
- `py -3.11` 能启动 Python，并能导入 hook 依赖的标准库模块（`json`、`pathlib`、`urllib.request`）。不传 `-Python` 时，native 启动脚本和 WPF UI 默认都使用 `py -3.11`。
- hook 脚本目录存在；如果设置了 `AGENTHUB_HOOKS_SOURCE_DIR`，该目录内必须有 Codex/Claude/Gemini hook 脚本。
- `powershell`、`cmd`、`scrolltest` 只提示使用 Host shell，不要求额外 Agent CLI。`scrolltest` 会默认检查 PowerShell host。
- publish check 输出 native project、hooks 目录和发布目录。

如果第一条失败，优先检查：

```powershell
where.exe codex
py -0p
py -3.11 --version
```

也可以一次性生成诊断报告，减少来回复制命令：

```powershell
.\scripts\collect-native-diagnostics.ps1 -Workspace V:\OrderManager -Python "py -3.11"
.\scripts\collect-native-diagnostics.ps1 -Workspace V:\OrderManager -Agent agents -Python "py -3.11"
```

默认报告位置是 `artifacts/native-diagnostics/<timestamp>.md`。报告头部会写明 `Execution mode` 和 `Agent selection`，用于区分当前运行的是源码仓库、发布包还是独立诊断脚本，以及 native 启动预检查的是 Codex 还是三类托管 Agent。这份报告只读收集 git、.NET、Windows 版本、显示缩放、Windows Terminal/Console Host 环境、native 终端后端依赖、输入设备、`Win32_PointingDevice`、Precision Touchpad 设置、Agent CLI、Codex native launcher、Codex `--no-alt-screen` 探测、Python、所选 Agent 的 native 启动预检、发布预检和 hook 日志摘要；即使命令失败，也会保留 exit code 和错误文本。native UI 顶部的 `Run diagnostics` 会调用同一诊断脚本，默认按 `-Agent agents` 采集 Codex、Claude、Gemini 预检信息，并把报告写到 `%LOCALAPPDATA%\AgentHub\Native\diagnostics\`；同目录的 `latest-diagnostics.txt` 会记录最近一次报告路径和 exit code。

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

`-Agent shell` 也是普通 shell 启动别名，默认选择 PowerShell host；需要 cmd 时使用 `-Agent cmd`。

先启动滚动烟测，确认 Codex 以外的普通输出是否能产生可滚动历史：

```powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Agent scrolltest
```

`scrolltest` 会在 native 终端里输出 240 行 `AgentHub scroll smoke line ...` 并停在 PowerShell 中。若这里有滚动条且鼠标/触摸板可滚，而 Codex 不能滚，问题更可能在 Codex TUI 行为；若这里也不能滚，问题更可能在 native 终端控件、Windows 输入设备或系统滚动设置。

## 发布版验证

在开发机或笔记本执行发布：

```powershell
.\scripts\publish-native.ps1
```

然后运行发布目录中的启动脚本：

```powershell
.\artifacts\native\win-x64\start-agenthub-native.bat -Workspace V:\OrderManager -Agent codex -Resume -Python "py -3.11"
```

发布版 `start-agenthub-native.bat` 和 `start-agenthub-native.ps1` 都会直接调用 native exe，并会把 `AGENTHUB_HOOKS_SOURCE_DIR` 固定为发布包内的 `scripts/hooks`。native exe 同时兼容 `-Workspace/-Agent/-Resume/-Python` 和 `--workspace/--agent/--resume/--python` 两种参数风格。发布包位于 NAS/UNC 路径时，优先使用 `.ps1` 入口可以避开 `cmd.exe` 的 UNC 当前目录提示。

发布目录也提供 `write-native-validation-report.bat/.ps1`。如果 UI 没有打开，也可以直接生成手工验证清单：

```powershell
.\artifacts\native\win-x64\write-native-validation-report.ps1 -Workspace V:\OrderManager
```

发布目录也可以直接生成诊断报告：

```powershell
.\artifacts\native\win-x64\collect-native-diagnostics.bat -Workspace V:\OrderManager -Python "py -3.11"
.\artifacts\native\win-x64\collect-native-diagnostics.ps1 -Workspace V:\OrderManager -Python "py -3.11"
.\artifacts\native\win-x64\collect-native-diagnostics.ps1 -Workspace V:\OrderManager -Agent agents -Python "py -3.11"
.\artifacts\native\win-x64\validate-native-laptop.ps1 -Workspace V:\OrderManager -Python "py -3.11"
.\artifacts\native\win-x64\validate-native-laptop.ps1 -Workspace V:\OrderManager -Agent agents -Python "py -3.11"
.\artifacts\native\win-x64\write-native-validation-report.ps1 -Workspace V:\OrderManager
```

需要确认发布目录存在：

```text
artifacts/native/win-x64/AgentHub.Native.App.exe
artifacts/native/win-x64/start-agenthub-native.bat
artifacts/native/win-x64/start-agenthub-native.ps1
artifacts/native/win-x64/collect-native-diagnostics.bat
artifacts/native/win-x64/collect-native-diagnostics.ps1
artifacts/native/win-x64/write-native-validation-report.bat
artifacts/native/win-x64/write-native-validation-report.ps1
artifacts/native/win-x64/scripts/collect-native-diagnostics.ps1
artifacts/native/win-x64/scripts/write-native-validation-report.ps1
artifacts/native/win-x64/scripts/hooks/agenthub_hook_common.py
artifacts/native/win-x64/scripts/hooks/agenthub_codex_stop.py
artifacts/native/win-x64/scripts/hooks/agenthub_claude_stop.py
artifacts/native/win-x64/scripts/hooks/agenthub_gemini_after_agent.py
```

## UI 验证点

打开 native app 后依次确认：

1. workspace 可以添加、选中和移除。
2. Host shell 默认是 PowerShell，并且可以切换到 cmd。
3. `Run diagnostics` 能生成报告，状态栏显示 `Diagnostics written: ...`。
4. `Open data` 能打开 native 数据目录，并能在 `diagnostics/` 里找到刚生成的报告和 `latest-diagnostics.txt`。
5. `Write validation` 能生成 `native-manual-validation-*.md`，状态栏显示 `Validation checklist written: ...`。
6. `Scroll Test` 能输出 240 行 smoke text，并且终端滚动条出现。
7. 鼠标滚轮和触摸板双指滚动能在 `Scroll Test` session 中向上翻历史。
8. `Resume Codex` 能进入 `codex --no-alt-screen resume`。
9. Codex TUI 刚进入时是否有终端滚动条。
10. 鼠标滚轮是否能向上翻历史。
11. 触摸板双指滚动是否能向上翻历史。
12. 底部输入框按 Enter 会发送。
13. 底部输入框按 Shift+Enter 会换行，不会发送。
14. 多行输入能被 Codex 收到。
15. `@codex message` 可以路由到最新 Codex session。
16. 如果同时启动 Claude/Gemini，`@claude`、`@gemini` 可以路由到对应 session。
17. Codex 完成响应后，Collaboration timeline 是否出现 hook 回传。
18. `Stop selected` 可以停止当前 session。
19. `Stop all` 可以停止全部 session。

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

或者直接回传：

```powershell
.\scripts\collect-native-diagnostics.ps1 -Workspace V:\OrderManager -Python "py -3.11"
.\scripts\collect-native-diagnostics.ps1 -Workspace V:\OrderManager -Agent agents -Python "py -3.11"
```

也可以在 native UI 里点击 `Run diagnostics`，再点击 `Open data`，从 `diagnostics/latest-diagnostics.txt` 读取最新报告路径并回传对应报告。跑完手工验证后，点击 `Write validation`，在 `diagnostics/` 目录找到最新的 `native-manual-validation-*.md`，勾选结果并一起回传。

如果使用一键验证脚本，则回传：

```text
artifacts/native-diagnostics/latest-laptop-validation.txt
```

以及该文件中 `report:` 指向的诊断报告。

同时说明：

- 使用的是 PowerShell host 还是 cmd host。
- 是鼠标滚轮不能滚、触摸板不能滚，还是滚动条本身不显示。
- `Scroll Test` session 是否能显示滚动条并用鼠标/触摸板滚动。
- 是刚进入 `codex --no-alt-screen resume` 就不显示，还是输出变多后才消失。
- Windows Terminal 或 VS Code 终端里同一个 `codex --no-alt-screen resume` 是否能滚动。
- AgentHub Native 状态栏最后显示的文本。
- 如果 hook 回传没有进入 timeline，请附上 `%LOCALAPPDATA%\AgentHub\Native\hooks.jsonl` 的最后几行。

## 当前已知边界

- 该分支是并行 native 原型，不替换 `desktop/` Electron 主线。
- 终端控件来自 `EasyWindowsTerminalControl`，底层使用 Windows Terminal backend / ConPTY，但不是微软官方稳定嵌入式 TerminalControl API。
- 当前项目 target framework 是 `.NET 10`；源码运行需要 .NET 10 SDK，默认发布包是 self-contained，不要求目标电脑额外安装 .NET Desktop Runtime。
- native app 不记录 Codex 实时原始输出；只记录用户消息、hook 回传、自动转发事件，以及 hook 诊断事件。
