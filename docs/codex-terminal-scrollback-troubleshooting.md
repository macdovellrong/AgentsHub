# Codex 终端滚动条问题排查记录

Updated: 2026-06-15 23:29:13 +08:00

## 问题现象

有的电脑在 AgentHub 内置 Codex 终端中启动 Codex，尤其执行 `resume` 后，终端没有滚动滑块，滚轮也不能向上查看当前终端窗口里的历史输出。

同一份项目在另一台电脑上可能正常，所以这类问题不能只按样式问题看。更可能的差异包括：

- AgentHub 代码版本不同。
- Electron/AgentHub 没有完全重启，仍在跑旧进程。
- 本机 profile 配置不同，例如 Codex profile 被保存成了 `custom`。
- Codex CLI 版本或安装方式不同。
- Codex 是否进入了 terminal alternate screen。
- xterm.js 在不同输入设备、渲染器、终端状态下的滚动行为差异。

## 当前判断

目前最可疑、也已经在本项目中确认过的方向是：Codex TUI 进入了 terminal alternate screen。

alternate screen 是终端程序常用机制，`vim`、`less`、`top`、很多 TUI 程序都会用。进入 alternate screen 后，终端通常不使用普通 scrollback，所以表现会像“滚动条没了”或“不能往上翻历史”。

Codex CLI 已经提供官方参数：

```text
--no-alt-screen
```

这个参数用于禁用 alternate screen，并保留终端 scrollback。AgentHub 已经在 Codex profile 启动时自动追加该参数。正常的 Codex resume 启动参数应类似：

```text
codex --no-alt-screen resume --last --cd <workspace>
```

相关代码：

```text
desktop/src/main/pty-session-manager.ts
```

相关提交：

```text
45cbaae fix: preserve Codex terminal scrollback
```

## VS Code 仓库相关线索

我查了 `microsoft/vscode` 仓库，发现 VS Code 集成终端近期也有多条和 xterm、alternate screen、scroll/marker 状态相关的问题。这说明这个问题方向和 VS Code 的终端问题有一定相关性，不是 AgentHub 独有现象。

相关 issue：

- https://github.com/microsoft/vscode/issues/312958
  - 标题涉及 renderer crash、infinite scroll loop、marker storm。
  - 描述中明确提到 alternate buffer 控制序列 `ESC[?1049h/l`。
  - 这和我们之前在 Codex 原始输出里看到的 alternate screen 控制序列是同一类机制。

- https://github.com/microsoft/vscode/issues/309782
  - 标题涉及 terminal marker 反复注册导致循环。
  - 复现方向包括 `less`、`git log`、`top` 这类会使用 alternate screen 的终端程序。
  - 说明 VS Code 终端也在处理 alternate screen、marker、scroll 状态时遇到过边界问题。

- https://github.com/microsoft/vscode/issues/249058
  - 现象是终端输出历史、滚动条状态不符合预期。
  - 虽然不一定和 Codex 是同一个根因，但症状类别接近。

- https://github.com/microsoft/vscode/issues/258103
  - 这是 Web/iPad/touch 场景的终端滚动问题。
  - 它说明触摸输入确实可能影响终端滚动体验，但更偏 Web/触摸环境，不能直接证明 Windows 笔记本触摸板就是本问题根因。

- https://github.com/microsoft/vscode/issues/314189
  - 讨论 Agent Host 终端状态跟踪。
  - 文中提到 full-screen apps、alternate screen、menus、pagers、editors 这类终端状态。
  - 方向上和 Codex TUI 的终端状态管理有关。

VS Code 也使用 xterm 生态。其仓库 `package.json` 中能看到 `@xterm/xterm` 和 `node-pty` 相关依赖：

```text
https://github.com/microsoft/vscode/blob/main/package.json
```

## VS Code 近期可参考修复

当前先不升级 AgentHub 的 `@xterm/xterm` 或 `node-pty`，只参考 VS Code 已落地的修复思路。

重点关联项：

- https://github.com/microsoft/vscode/pull/314795
  - `Guard terminal resize/dispose race against xterm.js dimension getters`
  - 该 PR 明确处理 `Cannot read properties of undefined (reading 'dimensions')`。
  - AgentHub 曾出现同类 xterm 报错，因此应先加强 resize/dispose 竞态防护。

- https://github.com/microsoft/vscode/pull/318177
  - `Replace @debounce with disposable RunOnceScheduler in TerminalResizeDebouncer`
  - 该 PR 的核心是确保 resize 延迟任务在 terminal/xterm dispose 后不会继续访问已销毁对象。
  - AgentHub 当前已有 `requestAnimationFrame` 调度和 dispose 取消逻辑，可以继续补充异常隔离，避免一次 xterm 内部异常打断 renderer。

- https://github.com/microsoft/vscode/pull/315407
  - `Add agent host xterm/headless`
  - VS Code 为 Agent Host 增加 headless xterm，用来镜像 PTY 输出并追踪 terminal state。
  - AgentHub 暂不引入 headless xterm，但可以先在可见 xterm 上增加 alt buffer 状态跟踪。

- https://github.com/microsoft/vscode/pull/316177
  - `Prevent alt-buffer hang in agent host terminals`
  - VS Code 检测命令是否进入 alternate buffer，并把这类交互式 TUI 作为特殊状态处理。
  - AgentHub 对 Codex 已通过 `--no-alt-screen` 尽量避免进入 alternate buffer；下一步应记录实际是否仍进入 alt buffer，便于判断笔记本问题是不是同一类。

- https://github.com/microsoft/vscode/pull/320646
  - VS Code 在 2026-06-09 升级到 `@xterm/xterm 6.1.0-beta.285`。
  - AgentHub 当前仍使用 `@xterm/xterm ^5.5.0`。这可能解释部分差异，但当前策略是先不升级，避免引入新变量。

本轮 AgentHub 修复策略：

1. 不升级依赖。
2. 先补 `dimensions` 读取异常和 resize/dispose 竞态防护。
3. 增加 Codex/Claude/Gemini 进入 alt buffer 的 renderer 侧诊断日志。
4. 用户在笔记本验证后，再决定是否需要继续对齐 VS Code 的 headless xterm 或 xterm 版本。

## 对“触摸板导致”的判断

触摸板有可能影响滚动事件，但目前它不是第一优先级的根因。

更合理的判断顺序是：

1. 先确认 Codex 启动参数里是否真的带了 `--no-alt-screen`。
2. 再确认当前运行的是不是最新 AgentHub 代码和最新 Electron 进程。
3. 再确认本机 Codex profile 的 `kind` 是否为 `codex`。
4. 如果以上都正常，再排查触摸板、鼠标滚轮、xterm wheel 事件、renderer 布局和系统输入差异。

原因是：即使不用触摸板，只要 TUI 进入 alternate screen，普通 scrollback 也可能不可用。触摸板更像是可能放大或暴露问题的输入差异，而不是当前最强证据指向的根因。

## AgentHub 当前实现要点

AgentHub 只会对 `kind === "codex"` 的 profile 自动追加 `--no-alt-screen`。

如果某台电脑上的 Codex profile 被配置成：

```json
{
  "kind": "custom"
}
```

即使命令也是 `codex` 或 `codex.cmd`，AgentHub 也不会自动追加 `--no-alt-screen`。

正确的 Codex profile 应类似：

```json
{
  "id": "codex",
  "kind": "codex",
  "command": "codex.cmd"
}
```

另外，为了减少 NAS 或慢盘卡顿，AgentHub 最新版本已经不再把 Codex、Claude、Gemini 的实时 PTY 输出写入 `raw.log`。因此新版本里，Codex run 的 `raw.log` 可能为空，这是预期行为。

排查启动参数时应优先看：

```text
<workspace>/.agenthub/runs/<runId>/meta.json
```

## 笔记本优先排查命令

在笔记本的项目根目录运行：

```powershell
git rev-parse HEAD
git status --short
```

确认至少包含修复提交：

```text
45cbaae fix: preserve Codex terminal scrollback
```

当前主线不应早于：

```text
e6222d8845f339fec953731ec12b8d0a428cb719
```

检查 Codex CLI：

```powershell
codex --version
codex resume --help | Select-String "no-alt-screen"
```

检查本机 AgentHub profile：

```powershell
Get-Content -Raw "$env:APPDATA\agenthub-desktop\profiles.json"
```

检查最近 Codex run 的启动参数，把 `$workspace` 改成 AgentHub 打开的项目路径：

```powershell
$workspace = "D:\你的项目路径"

Get-ChildItem "$workspace\.agenthub\runs" -Directory |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 10 |
  ForEach-Object {
    $meta = Join-Path $_.FullName "meta.json"
    if (Test-Path $meta) {
      Get-Content -Raw $meta | ConvertFrom-Json |
        Select-Object runId, profileId, command, args, startedAt
    }
  }
```

重点看最近一次 `profileId = codex` 的记录里，`args` 是否包含：

```text
--no-alt-screen
```

## 结论分支

如果 `meta.json` 里没有 `--no-alt-screen`：

```text
优先处理 AgentHub 代码版本、旧进程未重启、profile kind 配置、启动路径或旧配置问题。
```

如果 `meta.json` 里已经有 `--no-alt-screen`，但仍然没有滚动条：

```text
继续比较 Codex CLI 版本、xterm 渲染状态、实际启动的 profile、输入设备事件和 renderer 布局。
```

如果用户想看的不是当前终端窗口里的 scrollback，而是 resume 之前旧会话的完整终端输出：

```text
需要单独确认。resume 恢复的是 Codex 上下文，不一定会把旧终端输出完整重新打印到当前终端窗口。
```

## 给另一台电脑上的 Codex 的最小材料

让另一台电脑上的 Codex 先收集下面几项：

```powershell
git rev-parse HEAD
git status --short
codex --version
codex resume --help | Select-String "no-alt-screen"
Get-Content -Raw "$env:APPDATA\agenthub-desktop\profiles.json"
```

再提供最近 Codex run 的：

```text
<workspace>/.agenthub/runs/<runId>/meta.json
```

重点字段：

```text
profileId
command
args
startedAt
```
