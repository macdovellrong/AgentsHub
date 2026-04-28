# Repository Guidelines

## 项目结构与模块组织

本仓库是 Python `src/` 布局。主代码在 `src/agenthub/`：

- `process/`：PTY、subprocess pipe、输出清洗、交互式终端会话。
- `ui/`：PySide6 HMI、输出缓冲、workspace 选择、历史 runs UI。
- `storage/`：run 日志、运行索引、任务模型、用户设置、最近 workspace。
- `adapters/`：PowerShell、Codex、Claude、Gemini 等 agent 启动 profile。
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

## 未完成任务

- Electron HMI 新桌面壳，目录计划为 `desktop/`。
- xterm.js + node-pty PowerShell 终端 smoke。
- 多 Agent 独立终端窗口/停靠面板。
- Agent profile 与角色 prompt 编辑器，支持多个 profile 指向同一个 CLI。
- 中央结果流与 `.agenthub/events.jsonl`。
- `@profile` 路由迁移到 Electron IPC。
- run history 与任务看板迁移到 Electron UI。
- 受控 planner -> implementer -> reviewer 编排流程。
- 同 profile 多实例、写入锁与 git worktree 隔离。
- 自主 Agent-to-Agent 编排与转发。

## 安全与配置提示

不要提交 `.agenthub/`、日志、虚拟环境、缓存文件。workspace 日志位于 `<workspace>/.agenthub/runs/`，任务记录位于 `<workspace>/.agenthub/tasks/`。危险权限、自动写文件、自动编排必须显式可见并可控。
