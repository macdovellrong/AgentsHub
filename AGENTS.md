# Repository Guidelines

## 项目结构与模块组织

本仓库当前包含 Python 原型和 Electron 终端 smoke。Electron `desktop/` 是当前主线 UI；PyQt/Python HMI 仅作为归档和参考原型保留。

- `process/`：PTY、subprocess pipe、输出清洗、交互式终端会话。
- `ui/`：PySide6 HMI、输出缓冲、workspace 选择、历史 runs UI。
- `storage/`：run 日志、运行索引、任务模型、用户设置、最近 workspace。
- `adapters/`：PowerShell、Codex、Claude、Gemini 等 agent 启动 profile。
- `desktop/`：Electron + xterm.js + node-pty 桌面端终端 smoke，也是当前主线 UI。
- `desktop/src/main/`：Electron 主进程、IPC、PTY session 管理、run log 持久化。
- `desktop/src/renderer/`：React + xterm.js 终端 UI。
- `tests/`：pytest 测试。
- `docs/superpowers/`：设计 spec 和实现计划。

运行期数据写入 `.agenthub/`，不要提交。

## 开发、测试与运行命令

创建 Python 参考环境：

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
```

运行全部 Python 测试：

```powershell
python -m pytest -v
```

运行当前主线 Electron UI：

```powershell
cd desktop
npm install
npm run dev
```

如果 node-pty 安装或构建在 UNC 路径下失败，建议把仓库共享映射为盘符后从该盘符路径运行同样命令。

Electron 侧校验命令：

```powershell
cd desktop
npm run typecheck
npm test
npm run build
```

运行 legacy pipe smoke：

```powershell
$env:PYTHONPATH = "src"
python -m agenthub.main pipe-smoke
```

启动 legacy PyQt HMI：

```powershell
$env:PYTHONPATH = "src"
python -m agenthub.main hmi
```

## 编码风格与命名约定

使用 Python 3.11+、4 空格缩进、类型标注。小型结构化数据优先用 `dataclass`。文件、函数、测试使用 `snake_case`。保持模块边界清晰：UI 不直接处理 PTY 细节，进程控制不直接写 UI。

## 测试规范

测试框架是 pytest。每个行为变更都要补测试。测试文件命名为 `tests/test_<module>.py`，测试函数命名为 `test_<behavior>()`。Windows 专属 PTY 行为需要加平台 skip。提交前运行 `python -m pytest -v`。

## 提交与 PR 规范

沿用当前提交风格：

- `feat: add workspace selector`
- `feat: remember recent workspaces`
- `docs: add AgentHub Windows design spec`

每个提交只包含一个逻辑变更。PR 需要说明变更内容、测试结果；涉及 UI 的改动应附截图；涉及 workspace、日志、PTY 行为的改动要明确说明影响范围。

## 已完成任务

- Windows-only AgentHub 设计 spec。
- `PtyBackend` / `PipeBackend` 后端切片。
- PowerShell ConPTY smoke test。
- 最小 PySide6 HMI。
- 手动 PowerShell / Codex PTY session。
- PTY raw/clean 日志持久化。
- workspace 选择器。
- 最近 workspace 记忆，配置位于 `%APPDATA%\AgentHub\settings.json`。
- 运行记录索引，位于 `<workspace>/.agenthub/runs/runs.jsonl`。
- 历史 runs UI：查看当前 workspace 的运行记录并加载 `raw.log` / `clean.log`。
- Claude / Gemini profiles：加入手动 PTY session 与 headless review。
- 任务模型：标题、描述、状态、关联 run，位于 `<workspace>/.agenthub/tasks/tasks.jsonl`。
- 任务看板 UI：pending / running / review / done / failed。
- 更强终端输出处理：从简单 ANSI 清洗升级到 terminal screen buffer。
- 自动编排：Claude 拆任务、Codex 执行、Gemini review。
- 共享聊天式多 Agent HMI：同一 workspace 下并行运行 PowerShell / Codex / Claude / Gemini，并通过 `@agent` 定向发送。
- 多 Agent 会话保护：每个 Agent 独立写入 run 日志，任一 Agent 在线时禁止切换 workspace。
- Electron + xterm.js + node-pty 迁移设计 spec，目标是替代 PyQt 文本框终端渲染。
- Electron 终端 smoke 实现计划。
- Electron HMI 新桌面壳，目录为 `desktop/`。
- xterm.js + node-pty PowerShell 终端 smoke：支持启动 ConPTY、xterm 输入输出、raw log 持久化。
- E1：Electron 多 Agent profile 模型。已建立 PowerShell / Codex / Claude / Gemini 默认 profile，支持同一 CLI 多 profile、角色 prompt、命令、参数、默认目录、环境变量和写入锁配置。
- E2：Electron profile 编辑器。左侧 profile 列表支持创建、复制、删除、角色 prompt、命令参数和写入锁编辑，并持久化到本地配置。
- E3：Electron 多 Agent 并行 PTY。后端支持按 profile 启动多个 session，每个 session 独立 run_id、状态、日志和停止控制。
- E4：多终端停靠面板。界面支持每个 Agent 独立 xterm.js 终端、标签切换、焦点保持和单独停止。
- E5：中央聊天与结果流。中间区域只展示用户消息、任务、编排、转发、错误等事件；raw PTY 输出只进入 run log 和独立终端。
- E6：`.agenthub/events.jsonl`。事件模型已持久化用户消息、状态变化、任务流转、编排步骤、转发记录和错误。
- E7：`@profile` 路由迁移到 Electron IPC。输入框支持 `@codex` / `@claude` / `@gemini` / 自定义 profile 定向发送。
- E8：run history 迁移到 Electron UI。展示当前 workspace 的 runs，支持按 profile/status 过滤并加载 raw log。
- E9：任务看板迁移到 Electron UI。展示 pending / running / review / done / failed，支持任务创建、状态更新、关联 run 和刷新。
- E10：受控 planner -> implementer -> reviewer 编排。手动触发后创建任务，在线 profile 会收到单步 prompt，离线 profile 会写入 waiting_session 事件。
- E11：并发安全。实现 workspace 写入锁、在线 session 阻止 workspace 切换、独立 run 日志和多 session 停止控制；git worktree 隔离保留为后续增强选项。
- E12：自主 Agent-to-Agent 转发。新增转发存储、IPC/API 和 HMI 控制，支持创建、发送/继续、暂停、停止，并写入中央事件时间线。
- E13：旧 PyQt 原型归档。保留 Python 代码作为参考，不再作为主入口；README 和 AGENTS.md 明确 Electron 是当前主线。
- E14：端到端 smoke。验证 Windows 上可同时启动 PowerShell + Codex，中央输入可 `@profile` 路由，独立终端可交互，events/runs/tasks/forwards 都落盘。

## 未完成任务

暂无。后续增强项包括更细粒度文件级冲突检测、自动 worktree 隔离、Agent 输出摘要提取和更完整的编排状态机。

## 安全与配置提示

不要提交 `.agenthub/`、日志、虚拟环境、缓存文件。workspace 日志位于 `<workspace>/.agenthub/runs/`，任务记录位于 `<workspace>/.agenthub/tasks/`。危险权限、自动写文件、自动编排必须显式可见并可控。
