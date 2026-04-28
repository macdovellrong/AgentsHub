# AgentHub Electron 终端迁移设计

## 背景

当前 PyQt 原型已经验证了 Windows-only AgentHub 的核心方向：选择 workspace、启动多个 Agent、通过 ConPTY 读写终端、保存 run 日志、显示任务和历史记录。但它的终端体验存在结构性限制：`QPlainTextEdit` 只能显示普通文本，无法完整还原 ANSI 颜色、光标移动、alternate screen、交互式菜单和 spinner；同时中央共享时间线追加 screen snapshot，会把本应原地刷新的终端画面变成重复消息。

agent-deck 的体验更好，是因为它把真实终端作为渲染器使用，而不是把终端 UI 压平成文本。Windows 第一版要达到类似效果，应把终端渲染层换成浏览器端终端模拟器，并让 ConPTY 原始流直接进入该模拟器。

## 目标

- 放弃 Qt 作为主要 HMI 技术栈，改用 Electron 桌面壳。
- 使用 `node-pty` 管理 Windows ConPTY，使用 `xterm.js` 渲染每个 Agent 的真实终端。
- 保留 Windows-only 范围，优先跑通 Codex、Claude、Gemini、PowerShell。
- 把中央区域从“所有 raw CLI 输出堆叠区”改成“团队结果流 / 事件流”。
- 每个 Agent 拥有独立终端面板或独立终端窗口，交互式选择、方向键、颜色和动态刷新都在自己的终端中完成。
- 支持编辑每个 Agent profile 的角色提示词，并允许多个 profile 指向同一个 CLI，例如两个不同角色的 Codex。

## 非目标

- 不在本阶段追求跨平台。
- 不继续增强 PyQt 文本框终端渲染。
- 不做完全自主的 Agent-to-Agent 调度。
- 不默认启用危险权限、绕过审批或自动破坏性操作。
- 不在第一阶段实现多人协作、远程 Web 服务或云同步。

## 推荐技术栈

| 层级 | 选择 | 原因 |
|---|---|---|
| 桌面壳 | Electron | Chromium + Node.js 同进程生态，最适合 xterm.js 和 node-pty 组合。 |
| UI | React + TypeScript | 组件边界清晰，适合构建多面板 HMI。 |
| 终端渲染 | xterm.js | 浏览器端成熟终端模拟器，支持颜色、光标控制、alternate screen、resize。 |
| PTY | node-pty | Windows 走 ConPTY，适合 Electron 主进程管理本地 CLI。 |
| 存储 | JSONL + SQLite 后续可选 | 第一版沿用日志文件和轻量索引，等事件模型稳定后再引入 SQLite。 |
| 测试 | Vitest + Playwright | 单元测试 IPC/解析逻辑，E2E 测试终端启动和 UI 行为。 |

Tauri 也是可行路线，但第一版不推荐。它需要额外处理 Rust PTY 桥接、WebView2 IPC 和前后端类型转换，迭代速度低于 Electron + node-pty。

## 总体架构

```text
AgentHub Electron
+-- Main Process
|   +-- WorkspaceManager
|   +-- AgentProfileStore
|   +-- PtySessionManager
|   +-- RunLogStore
|   +-- EventFeedStore
|   +-- Orchestrator
|   +-- SafetyPolicy
+-- Renderer Process
|   +-- AgentRoster
|   +-- TeamEventFeed
|   +-- TerminalDock
|   +-- TerminalWindow
|   +-- RolePromptEditor
|   +-- TaskBoard
|   +-- RunHistory
+-- Local Workspace Data
    +-- .agenthub/
        +-- profiles.json
        +-- runs/
        +-- events.jsonl
        +-- tasks.jsonl
```

Electron 主进程拥有所有本地进程、文件和安全权限。Renderer 只通过 IPC 调用主进程，不直接启动 CLI、不直接写 workspace 文件。这样可以把 UI 崩溃、终端崩溃和 Agent 进程生命周期隔离开。

## 进程与终端模型

每个在线 Agent 对应一个 `PtySession`：

```ts
type PtySession = {
  id: string;
  profileId: string;
  workspacePath: string;
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  status: "starting" | "online" | "busy" | "exited" | "error";
};
```

主进程通过 `node-pty.spawn()` 启动 CLI，并监听 `onData`。数据流同时进入三条路径：

- 原始 PTY bytes/text 发送给对应 xterm.js 终端。
- 原始流写入 `raw.log`。
- 轻量清洗后的文本进入状态检测器，用于识别“需要输入”“可能完成”“进程退出”等事件。

ConPTY 本身是合并终端流，进入 PTY 后无法再分离 stdout/stderr。需要分离 stdout/stderr 的一次性任务应使用后续的 pipe job，而不是 interactive PTY。

## HMI 布局

第一版 UI 使用操作台风格，而不是营销页或装饰型 dashboard。

```text
+-------------------------------------------------------------+
| 顶部：workspace、全局状态、运行/停止控制                    |
+-------------+-------------------------------+---------------+
| Agent 列表   | 团队结果流 / 事件流            | 任务/历史/详情 |
| Profile 编辑 | 用户消息、Agent 摘要、错误      | Run、日志、配置 |
| 启动/停止     | @agent 输入框                  |               |
+-------------+-------------------------------+---------------+
| 底部/停靠：一个或多个 Agent 真实终端 xterm.js               |
+-------------------------------------------------------------+
```

中央区域不再承载完整 CLI raw 输出。它只显示：

- 用户发送的消息。
- Agent 开始/停止/退出事件。
- Agent 提交的最终结果或摘要。
- “需要人工输入”的提醒。
- 编排器的任务分配和路由决策。
- 错误和安全策略拦截。

完整终端输出只出现在对应 Agent 的终端面板中。用户可以把终端停靠在底部、右侧，或弹出成独立窗口。交互式菜单、审批提示、方向键选择都在该终端里完成。

## Agent Profile 与角色提示

Agent profile 是“角色实例”，不是 CLI 名称。多个 profile 可以共享同一个 CLI 命令：

```json
{
  "id": "codex-implementer",
  "name": "Codex 实现者",
  "cli": "codex",
  "command": "codex",
  "rolePrompt": "你负责实现代码变更，保持改动最小并运行测试。",
  "canWriteFiles": true,
  "dangerousMode": false
}
```

例如可以同时配置：

- `codex-implementer`：负责写代码。
- `codex-reviewer`：只读审查，不写文件。
- `claude-planner`：拆任务和整理方案。
- `gemini-reviewer`：审查 diff 和边界风险。

启动 Agent 时，主进程把 profile 的 role prompt 作为第一条初始化输入或包装到后续用户消息中。第一版不强行统一各 CLI 的系统提示机制，而是在 adapter 中处理不同 CLI 的注入方式。

## IPC 协议

Renderer 到主进程：

```text
workspace:select(path)
profile:list()
profile:save(profile)
agent:start(profileId)
agent:stop(sessionId)
terminal:input(sessionId, data)
terminal:resize(sessionId, cols, rows)
chat:send(targetProfileId, text)
run:list(workspacePath)
run:open(runId, kind)
```

主进程到 Renderer：

```text
agent:status(sessionId, status)
terminal:data(sessionId, chunk)
event:append(event)
run:created(run)
run:updated(run)
safety:blocked(reason)
error(message, context)
```

终端数据事件只发给对应终端组件，不进入中央结果流。中央结果流只消费 `event:append`。

## @agent 路由

统一输入框支持 `@profile` 路由：

- `@codex-implementer 修改解析器`
- `@claude-planner 拆分这个需求`
- `@gemini-reviewer review 当前 diff`

不带前缀时发送给当前默认 profile。发送逻辑：

1. Renderer 解析目标 profile。
2. 如果目标离线，中央结果流显示“目标未启动”，不自动启动。
3. 如果目标在线，主进程把用户文本包装为 CLI 输入并写入对应 PTY。
4. 中央结果流记录用户消息和路由目标。

如果用户需要处理 CLI 菜单或审批，应该打开该 Agent 的终端，而不是依赖统一输入框。

## 日志与状态

每个 run 使用独立目录：

```text
.agenthub/runs/<run-id>/
  raw.log
  clean.log
  events.jsonl
  meta.json
```

`raw.log` 保存 PTY 原始流，是复盘终端问题的证据。`clean.log` 保存清洗文本，便于搜索。`events.jsonl` 保存结构化事件，例如启动、退出、需要输入、用户消息、摘要。`meta.json` 保存 profile、workspace、命令、开始时间、结束时间、退出码。

全局团队事件追加到：

```text
.agenthub/events.jsonl
```

这份文件服务中央结果流，不替代每个 run 的原始日志。

## 状态检测

第一版只做保守检测：

- 进程启动、退出、错误。
- 长时间无输出。
- 明确的审批/输入提示关键词。
- 用户手动标记“这段输出是结果”。

不要用脆弱的终端布局 scraping 判断任务完成。Codex、Claude、Gemini 的 TUI 会频繁变化，关键状态必须来自进程生命周期、用户确认、显式 sentinel 或后续 headless 命令。

## 自动编排边界

迁移后的第一版仍以人工监督为主。编排器可以做：

- 把用户需求发给 planner profile。
- 根据 planner 输出创建任务。
- 用户确认后把任务发给 implementer profile。
- 完成后把 diff 或日志发给 reviewer profile。
- 把 reviewer 结果写入中央事件流。

编排器不应该在无人确认时连续推进多个写文件任务。危险模式必须在 profile 上显式开启，并在 UI 和日志中可见。

## 迁移策略

采用并行迁移，不直接删除 Python/PyQt 原型。

建议新增目录：

```text
desktop/
  package.json
  electron/
    main/
    preload/
  renderer/
    src/
      components/
      stores/
      terminals/
      views/
  tests/
```

现有 `src/agenthub/` 保留为原型和行为参考。迁移过程中，优先复刻已验证的领域概念：workspace、profile、run logs、tasks、history、orchestration。不要逐行搬运 PyQt UI。

## 分阶段交付

### 阶段 1：Electron 终端烟测

- 启动 Electron 窗口。
- 用 node-pty 启动 PowerShell。
- 用 xterm.js 显示彩色终端。
- 支持输入、Ctrl+C、resize。
- 写入 `raw.log`。

验收：PowerShell 输出能保持颜色和交互效果，终端不再黑白堆叠。

### 阶段 2：多 Agent 终端

- 增加 Agent profile 配置。
- 支持 Codex、Claude、Gemini、PowerShell。
- 每个 profile 启动独立 xterm.js 终端。
- 支持多个 profile 指向同一个 CLI。
- 支持编辑 role prompt。

验收：同一 workspace 下可以同时运行多个不同角色的 Agent，互不冲刷终端画面。

### 阶段 3：中央结果流

- 实现 `events.jsonl`。
- 中央区域只显示用户消息、状态事件、摘要、错误。
- `@profile` 输入路由到指定 Agent。
- 终端数据不直接进入中央结果流。

验收：中央区域可读，不再被 CLI 动态输出污染。

### 阶段 4：历史与任务

- 迁移 run history。
- 迁移任务看板。
- 支持打开 raw/clean/events 日志。
- 支持把某段 Agent 输出标记为任务结果。

验收：一次 Agent 运行可以完整复盘，任务状态和日志可追踪。

### 阶段 5：受控编排

- 实现 planner -> implementer -> reviewer 的手动确认流程。
- 写文件 Agent 和只读 Agent 的权限在 UI 中明确区分。
- 编排动作写入事件流。

验收：用户可以监督多 Agent 协作，不需要把所有操作混在一个终端里。

## 测试策略

单元测试：

- profile 保存和读取。
- `@profile` 路由解析。
- run metadata 写入。
- safety policy。
- 状态检测器。

集成测试：

- node-pty 启动 PowerShell。
- 发送 `echo AGENTHUB_OK` 并捕获输出。
- resize 后终端尺寸同步。
- 多 session 并行输出互不串线。

E2E 测试：

- Electron 启动。
- 创建 workspace。
- 启动 PowerShell terminal。
- 发送命令并看到 xterm 输出。
- 打开/关闭 Agent 终端窗口。
- 中央事件流只出现结构化事件。

## 风险与应对

- `node-pty` Windows 编译依赖较重：先固定 Node/Electron 版本，并记录 Windows C++ Build Tools 要求。
- Electron 体积大：第一版接受体积换迭代速度，产品形态稳定后再评估 Tauri。
- xterm.js 与 ConPTY 编码问题：所有 session 默认 UTF-8，启动 PowerShell 时显式设置 code page 和输出编码。
- 多 Agent 同 workspace 写文件冲突：第一版只做可见风险提示，后续再引入 git worktree 或写入锁。
- 角色提示注入方式不统一：通过 adapter 封装，不在 UI 层硬编码 CLI 细节。

## MVP 验收标准

- Windows 上可以从源码启动 Electron HMI。
- PowerShell、Codex、Claude、Gemini 至少能各自启动一个独立终端。
- 终端保留颜色、动态刷新和交互式输入。
- 中央区域不显示完整 raw CLI 输出，只显示用户消息、状态和结果事件。
- 每个 Agent 运行都有独立 raw 日志和 metadata。
- 可以编辑并保存 Agent profile 的角色提示。
- 可以在同一 workspace 下同时运行多个不同 profile，包括多个指向 Codex 的 profile。
- `@profile` 输入能稳定路由到目标 Agent。

## 设计依据

- Microsoft ConPTY 是 Windows 上托管字符模式应用的伪控制台机制。
- `node-pty` 支持 Windows ConPTY，适合编写终端模拟器和让 CLI 认为自己运行在真实终端中。
- `xterm.js` 是浏览器端终端模拟器，适合 Electron Renderer 承载真实终端体验。
- Electron 提供 Chromium 和 Node.js 运行时，能用较少桥接代码连接 xterm.js 与 node-pty。
