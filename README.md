# AgentHub

Windows-only desktop HMI for managing local CLI agents.

## Current Mainline UI

The active UI is the Electron desktop app in `desktop/`. It uses Electron,
React, xterm.js, and node-pty for ConPTY-backed terminals.

Run it on Windows:

```powershell
cd desktop
npm install
npm run dev
```

If node-pty install or build fails from a UNC path, map the repository share to a
drive letter and run the same commands from that mapped drive. Native Node
modules are often more reliable from a normal drive path than from `\\server`
or `\\?\UNC\...` paths.

You can also start the Electron app from the repository root:

```powershell
.\scripts\start-electron.ps1
```

In the Electron smoke UI, click `Start PowerShell` to start a ConPTY-backed
PowerShell session rendered by xterm.js. Raw terminal logs are written under
`<workspace>/.agenthub/runs/`.

## Development

Install the Python reference environment when working on the archived prototype
or shared Python libraries:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
```

Run Python tests:

```powershell
.\.venv\Scripts\python -m pytest -v
```

Run Electron checks:

```powershell
cd desktop
npm run typecheck
npm test
npm run build
```

## Legacy Python Prototype

The PyQt/Python HMI remains in the repo as an archived/reference prototype. It
is no longer the primary entrypoint for AgentHub.

Run the legacy pipe smoke:

```powershell
$env:PYTHONPATH = "src"
python -m agenthub.main pipe-smoke
```

Run the legacy PyQt HMI:

```powershell
.\scripts\start-hmi.ps1
```

Run one explicit legacy orchestration pass:

```powershell
$env:PYTHONPATH = "src"
python -m agenthub.main orchestrate "Implement the requested change" --workspace C:\path\to\workspace
```

The legacy HMI supports manual PowerShell, Codex, Claude, and Gemini PTY
sessions, shared `@agent` routing, workspace selection, run history, and a task
board. These features are reference behavior for the Electron migration rather
than the current mainline UI.

## Runtime Data

AgentHub writes runtime data under the selected workspace:

- `<workspace>/.agenthub/runs/`: raw and clean terminal logs plus `runs.jsonl`.
- `<workspace>/.agenthub/tasks/`: task records in `tasks.jsonl`.

User settings for recent workspaces are stored in
`%APPDATA%\AgentHub\settings.json`.
