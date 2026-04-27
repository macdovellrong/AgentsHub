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
