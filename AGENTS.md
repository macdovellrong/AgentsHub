# Repository Guidelines

## 项目结构与模块组织

本仓库当前包含 Python 原型和 Electron 终端 smoke。主代码位置：

- `process/`：PTY、subprocess pipe、输出清洗、交互式终端会话。
- `ui/`：PySide6 HMI、输出缓冲、workspace 选择、历史 runs UI。
- `storage/`：run 日志、运行索引、任务模型、用户设置、最近 workspace。
- `adapters/`：PowerShell、Codex、Claude、Gemini 等 agent 启动 profile。
- `desktop/`：Electron + xterm.js + node-pty 桌面端终端 smoke。
- `desktop/src/main/`：Electron 主进程、IPC、PTY session 管理、run log 持久化。
- `desktop/src/renderer/`：React + xterm.js 终端 UI。
- `tests/`：pytest 测试。
- `docs/superpowers/`：设计 spec 和实现计划。

运行期数据写入 `.agenthub/`，不要提交。

## 开发、测试与运行命令

创建开发环境：

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
```

运行全部测试：

```powershell
python -m pytest -v
```

运行 pipe smoke：

```powershell
$env:PYTHONPATH = "src"
python -m agenthub.main pipe-smoke
```

启动 HMI：

```powershell
$env:PYTHONPATH = "src"
python -m agenthub.main hmi
```

运行 Electron 终端 smoke：

```powershell
cd desktop
npm install
npm run dev
```

Electron 侧校验命令：

```powershell
cd desktop
npm run typecheck
npm test
npm run build
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

## 未完成任务

- E1：Electron 多 Agent profile 模型。建立 PowerShell / Codex / Claude / Gemini 默认 profile，支持同一 CLI 的多 profile、角色 prompt、启动命令、参数、默认工作目录和环境变量。
- E2：Electron profile 编辑器。左侧提供 profile 列表、创建/复制/删除、角色 prompt 编辑、命令参数编辑，并持久化到本地配置。
- E3：Electron 多 Agent 并行 PTY。后端支持按 profile 启动多个 session，每个 session 独立 run_id、状态、日志和停止控制。
- E4：多终端停靠面板。界面支持每个 Agent 独立终端、显示/隐藏、焦点切换、分屏停靠和单独停止，不再只显示一个 PowerShell。
- E5：中央聊天与结果流。中间区域改为 Agent 消息时间线，只展示用户输入、Agent 结果、系统事件和摘要；raw 终端输出留在独立终端面板。
- E6：`.agenthub/events.jsonl`。定义事件模型并持久化用户消息、Agent 输出摘要、状态变化、任务流转、错误和审查结果。
- E7：`@profile` 路由迁移到 Electron IPC。输入框支持 `@codex` / `@claude` / `@gemini` / 自定义 profile 定向发送；无前缀时使用默认目标。
- E8：run history 迁移到 Electron UI。展示当前 workspace 的 runs，支持按 profile/status 过滤，加载 raw log 到终端面板，加载结果事件到中央时间线。
- E9：任务看板迁移到 Electron UI。展示 pending / running / review / done / failed，支持任务创建、状态更新、关联 run 和刷新。
- E10：受控 planner -> implementer -> reviewer 编排。提供可手动触发的流程：Claude 拆任务，Codex 执行，Gemini/Claude 审查，全程写入 tasks/runs/events。
- E11：并发安全。实现同 profile 多实例命名、workspace 写入锁、危险操作提示和可选 git worktree 隔离，避免多个 Agent 同时改同一文件集合。
- E12：自主 Agent-to-Agent 转发。允许受控规则下把某个 Agent 的结果转发给另一个 Agent，并在中央时间线中可见、可暂停、可停止。
- E13：旧 PyQt 原型归档。保留 Python 代码作为参考，不再作为主入口；README 和 AGENTS.md 明确 Electron 是当前主线。
- E14：端到端 smoke。验证 Windows 上可同时启动至少 PowerShell + Codex 两个 profile，中央输入可 `@profile` 路由，独立终端可交互，events/runs/tasks 都落盘。

## 安全与配置提示

不要提交 `.agenthub/`、日志、虚拟环境、缓存文件。workspace 日志位于 `<workspace>/.agenthub/runs/`，任务记录位于 `<workspace>/.agenthub/tasks/`。危险权限、自动写文件、自动编排必须显式可见并可控。
