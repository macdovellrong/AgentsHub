# AgentHub

Windows-only V1 desktop HMI for managing local CLI agents.

## Development

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
.\.venv\Scripts\python -m pytest
```

Run the current source tree without installing:

```powershell
$env:PYTHONPATH = "src"
python -m agenthub.main pipe-smoke
```

Run the minimal desktop HMI:

```powershell
.\scripts\start-hmi.ps1
```

## HMI 共享聊天

HMI 中间区域是共享聊天时间线。左侧 roster 可以分别启动
PowerShell、Codex、Claude、Gemini；同一 workspace 内，不同 Agent 可并行
运行。输入框支持 `@codex`、`@claude`、`@gemini`、`@powershell` 定向发送；
无前缀时默认发送给 Codex。

每个 Agent 仍独立写入 `.agenthub/runs/` 下的 raw/clean run 日志。任一
Agent 在线时禁止切换 workspace。

Run one explicit orchestration pass:

```powershell
$env:PYTHONPATH = "src"
python -m agenthub.main orchestrate "Implement the requested change" --workspace C:\path\to\workspace
```

HMI 当前支持手动 PowerShell、Codex、Claude、Gemini PTY session。选择 workspace 后，在左侧 roster 启动所需 Agent，再通过共享输入框发送消息；需要指定目标时使用 `@agent` 前缀。

Headless Claude/Gemini review is available through `agenthub.adapters.headless`.
It uses `PipeBackend` to run one-shot non-interactive commands and returns a
`ProcessResult` with separated stdout/stderr.

AgentHub remembers the last selected workspace and recent workspaces in `%APPDATA%\AgentHub\settings.json`.

Each HMI session writes logs under `<workspace>/.agenthub/runs/<run-id>/`:

- `raw.log`: the original PTY terminal stream, including ANSI/control sequences.
- `clean.log`: the display-safe text stream used by the HMI.

Live HMI output is rendered through a terminal screen buffer snapshot so ANSI
colors, carriage-return progress updates, clear-screen, and home-cursor control
sequences produce stable visible text. The raw and clean log files keep their
existing stream formats.

Each workspace also keeps a queryable run index at
`<workspace>/.agenthub/runs/runs.jsonl`. Each record includes the agent profile,
workspace, start/end time, log paths, and status.

Tasks are persisted per workspace at `<workspace>/.agenthub/tasks/tasks.jsonl`.
Use `agenthub.storage.tasks.TaskStore` to create tasks, update their status, and
attach a related `run_id`.

Automatic orchestration is only triggered by the explicit `orchestrate` CLI
command. It asks Claude to split the requirement into tasks, persists those
tasks in the selected workspace, runs each task through `codex exec` with the
`workspace-write` sandbox, then asks Gemini for a headless review. It does not
start from the HMI or at process startup, and it does not use bypass-danger
approval flags.

The HMI shows a task board for the selected workspace, grouped by pending,
running, review, done, and failed status. Use "刷新任务" to reload
`tasks.jsonl` after external changes.

The HMI includes a history runs panel for the selected workspace. Use
"刷新历史" to reload `runs.jsonl`, then select a run and load either `clean.log`
or `raw.log` into the terminal area for review.
