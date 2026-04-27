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

The HMI currently supports manual PowerShell and Codex PTY sessions. Select the agent, start the session, then type commands or prompts into the input box.

Each HMI session writes logs under `.agenthub/runs/<run-id>/`:

- `raw.log`: the original PTY terminal stream, including ANSI/control sequences.
- `clean.log`: the display-safe text stream used by the HMI.
