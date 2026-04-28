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
$env:PYTHONPATH = "src"
python -m agenthub.main hmi
```

The HMI currently supports manual PowerShell and Codex PTY sessions. Select the workspace directory, select the agent, start the session, then type commands or prompts into the input box.

AgentHub remembers the last selected workspace and recent workspaces in `%APPDATA%\AgentHub\settings.json`.

Each HMI session writes logs under `<workspace>/.agenthub/runs/<run-id>/`:

- `raw.log`: the original PTY terminal stream, including ANSI/control sequences.
- `clean.log`: the display-safe text stream used by the HMI.

Each workspace also keeps a queryable run index at
`<workspace>/.agenthub/runs/runs.jsonl`. Each record includes the agent profile,
workspace, start/end time, log paths, and status.

The HMI includes a history runs panel for the selected workspace. Use
"刷新历史" to reload `runs.jsonl`, then select a run and load either `clean.log`
or `raw.log` into the terminal area for review.
