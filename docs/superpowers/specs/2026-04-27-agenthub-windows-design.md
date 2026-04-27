# AgentHub Windows V1 Design

## Goal

AgentHub Windows is a local desktop HMI for managing multiple CLI agents on Windows. V1 focuses on a reliable local control loop: start CLI processes through ConPTY, stream and display output, inject input, persist logs and task state, and prepare a clean path for Codex, Claude, and Gemini collaboration.

The first usable target is not a full golutra clone. It is a smaller, more deterministic agent management hub:

- Windows-only desktop app.
- PySide6/QML HMI.
- pywinpty-backed ConPTY sessions for interactive terminal control.
- subprocess-backed pipe jobs for non-interactive CLI calls.
- SQLite as the single source of truth.
- Codex first, then Claude and Gemini.
- Terminal output is treated as evidence/log data, not the primary state machine.

## Non-Goals For V1

- Cross-platform support.
- Full terminal emulator parity with Windows Terminal.
- Terminal UI scraping as the main orchestration mechanism.
- Multi-user or networked server mode.
- Automatic code approval bypass by default.
- Plugin marketplace, cloud sync, or remote runners.
- Complete golutra feature parity.

## Recommended Stack

| Layer | Choice | Reason |
|---|---|---|
| UI | PySide6 + QML | Fast desktop iteration, native Windows feel, good signal/slot bridge. |
| Process control | pywinpty / ConPTY plus subprocess pipes | PTY for interactive sessions; pipes for deterministic headless jobs. |
| Core | Python | Faster orchestration, text processing, and adapter iteration. |
| Storage | SQLite | Durable local state with simple migrations. |
| Packaging | PyInstaller or Nuitka later | V1 can run from source first. |

Qt is useful but not mandatory long-term. If the Python process-control layer proves stable, it can stay in-process. If it does not, the `PtyBackend` can later be replaced by a Rust or C++ service without rewriting the HMI concepts.

## Architecture

```text
AgentHub Desktop
+-- HMI Layer
|   +-- Agent panel
|   +-- Task board
|   +-- Discussion view
|   +-- Terminal output view
|   +-- Manual intervention input
+-- Core Layer
|   +-- SessionManager
|   +-- AgentManager
|   +-- TaskManager
|   +-- MessageBus
|   +-- Orchestrator
|   +-- PolicyEngine
+-- Process Backend Layer
|   +-- ProcessBackend interface
|   +-- PtyBackend: pywinpty / ConPTY
|   +-- PipeBackend: subprocess stdout/stderr pipes
|   +-- OutputNormalizer
|   +-- TerminalScreenBuffer
|   +-- ProcessLifecycle
+-- Agent Adapters
|   +-- ShellAdapter
|   +-- CodexAdapter
|   +-- ClaudeAdapter
|   +-- GeminiAdapter
+-- Storage Layer
    +-- SQLite database
    +-- run log files
    +-- artifacts directory
```

## Component Design

### HMI Layer

The UI is a desktop control panel. It should be operational rather than decorative.

Primary views:

- Agent panel: shows configured agents, online/offline state, current task, and write permission.
- Task board: lists tasks by status: pending, running, needs review, done, failed.
- Discussion view: shows user, Claude, Codex, Gemini, and system messages in one timeline.
- Terminal output view: shows selected session output as sanitized text. Raw output remains persisted separately.
- Manual intervention input: lets the user send text directly to a selected agent session.

The UI must never read from PTY directly. It receives updates through Qt signals emitted by backend controller objects.

### Process Backend Layer

The process backend layer owns process control. It must be isolated from orchestration logic and expose one interface to the core layer.

V1 supports two backends:

- `PtyBackend`: starts interactive sessions through pywinpty / ConPTY.
- `PipeBackend`: starts non-interactive jobs through `subprocess.Popen` with stdout and stderr pipes.

Use `PtyBackend` when an agent needs a real terminal: interactive prompts, approval flows, Ctrl+C, resize, terminal width, or long-lived manual intervention. Use `PipeBackend` when an adapter can run in headless mode and should exit after one request, such as `claude -p` or `gemini -p`.

Responsibilities:

- Create Windows ConPTY sessions using pywinpty.
- Start pipe-backed subprocess jobs when the adapter asks for headless mode.
- Start `powershell.exe`, `cmd.exe`, `codex`, `claude`, and `gemini`.
- Write text to stdin.
- Read PTY output continuously from a background thread.
- Read pipe stdout and stderr independently for headless jobs.
- Emit normalized output events to the core layer.
- Resize terminal dimensions.
- Kill, restart, and mark process exit status.

Default terminal size:

```text
cols = 120
rows = 40
```

No PTY or pipe read loop may run on the UI thread.

PTY sessions expose one merged terminal stream. The Windows terminal model does not preserve separate stdout and stderr streams once output enters ConPTY. Pipe jobs may expose stdout and stderr separately.

### Output Normalizer And Terminal Screen Buffer

The output normalizer converts process streams into display-safe events while keeping raw data available.

Outputs:

- raw chunk: original bytes/text from PTY or pipes.
- clean text: plain text suitable for logs and simple display.
- screen snapshot: terminal screen state reconstructed from ANSI/control sequences.
- stream name: `pty`, `stdout`, or `stderr`, depending on backend.
- semantic hints: optional parsed markers such as exit prompts or known CLI status lines.

V1 may start with a conservative ANSI stripper for simple display. The design target is a terminal screen buffer such as `pyte`, because real CLIs use carriage returns, cursor movement, clear-screen commands, and spinners that cannot be handled correctly with regex alone.

V1 should only rely on clean text and explicit adapter signals for display and debugging. It should not make critical workflow decisions from fragile terminal UI scraping.

Output events must be batched before reaching the UI. A backend may read as fast as needed, but the Qt bridge should flush updates at a fixed cadence such as every 50 ms, or sooner only when a session exits.

### Core Layer

The core layer coordinates app state.

SessionManager:

- Tracks PTY sessions and pipe jobs through a shared process-handle model.
- Maps session IDs to agents and workspaces.
- Handles session lifecycle events.

AgentManager:

- Stores agent definitions.
- Knows each agent command, role, and permissions.

TaskManager:

- Creates and updates task records.
- Enforces valid status transitions.

MessageBus:

- Records messages.
- Routes messages to interactive agent sessions or headless agent jobs when requested.

Orchestrator:

- Implements workflow steps.
- Starts with simple explicit flows before autonomous scheduling.

PolicyEngine:

- Blocks unsafe actions unless user explicitly enables them.
- Codex may write files.
- Claude and Gemini default to read/review roles.

### Agent Adapters

Adapters convert generic AgentHub actions into CLI-specific prompts, launch commands, and backend mode requests.

ShellAdapter:

- Used for PTY smoke tests.
- Starts PowerShell or cmd through `PtyBackend`.

CodexAdapter:

- First real agent adapter.
- Starts `codex` in a workspace, usually through `PtyBackend` for interactive approval and intervention.
- Supports manual prompt injection.
- Later supports structured execution prompts.

ClaudeAdapter:

- Manager/reviewer role in V1.1.
- Does not write files by default.
- May use `PipeBackend` for `claude -p` review jobs and `PtyBackend` for interactive sessions.

GeminiAdapter:

- Reviewer/research role in V1.1.
- Does not write files by default.
- May use `PipeBackend` for `gemini -p` review jobs and `PtyBackend` for interactive sessions.

Dangerous flags such as Codex sandbox bypass, Claude permission bypass, or Gemini yolo mode must be opt-in per agent and visibly marked in the UI.

## Data Model

SQLite tables:

### agents

- id
- name
- role
- cli_type
- command
- workspace_path
- can_write_files
- dangerous_mode_enabled
- status
- created_at
- updated_at

### sessions

- id
- agent_id
- process_id
- backend_mode
- cwd
- cols
- rows
- status
- started_at
- ended_at
- exit_code

### tasks

- id
- title
- description
- status
- assigned_agent_id
- priority
- created_at
- started_at
- finished_at

### messages

- id
- sender
- receiver
- message_type
- content
- task_id
- session_id
- created_at

### runs

- id
- task_id
- agent_id
- session_id
- command
- backend_mode
- status
- raw_log_path
- clean_log_path
- stdout_log_path
- stderr_log_path
- summary
- exit_code
- started_at
- finished_at

For `PtyBackend` runs, `raw_log_path` and `clean_log_path` are authoritative because ConPTY exposes one merged terminal stream. For `PipeBackend` runs, `stdout_log_path` and `stderr_log_path` may be populated separately, and `raw_log_path` may store an interleaved event log if needed.

### artifacts

- id
- run_id
- kind
- path
- metadata_json
- created_at

## Workflow

### Phase 1: PTY Smoke Test

1. Start a PowerShell PTY.
2. Display the output in the HMI.
3. Send `echo AGENTHUB_PTY_OK`.
4. Verify clean text reaches the UI.
5. Persist raw and clean output.
6. Stop the session.

Success means the app can reliably start a Windows terminal process, write input, read output, and keep the UI responsive.

### Phase 2: Single Codex Session

1. Configure a Codex agent.
2. Start Codex in a selected workspace.
3. Send a manual prompt through the HMI.
4. Capture output.
5. Save a run record.

No autonomous task routing is required yet.

### Phase 3: State-Backed Tasks

1. User creates a task.
2. User assigns it to Codex.
3. HMI sends a generated execution prompt.
4. Codex output is attached to the task.
5. User marks task done, failed, or needs review.

### Phase 4: Multi-Agent Loop

1. Claude receives the user goal and proposes tasks.
2. User approves or edits the tasks.
3. Codex executes one task.
4. Gemini reviews the result.
5. Claude recommends the next task.
6. AgentHub records all decisions and state transitions.

The user remains in control for V1. Automated progression can be introduced after the manual loop is stable.

## State Machine

Task states:

```text
pending -> assigned -> running -> needs_review -> done
pending -> assigned -> running -> failed
needs_review -> running
failed -> assigned
```

Session states:

```text
created -> starting -> online -> busy -> idle -> exited
starting -> failed
online -> restarting -> online
```

Agent states:

```text
offline -> starting -> online -> busy -> offline
starting -> error
```

## Completion Detection

Pipe jobs complete when the child process exits. The backend records `exit_code`, final stdout/stderr chunks, and the finish timestamp.

PTY sessions do not have a reliable "current command is done" signal when the process stays alive. AgentHub must use explicit completion strategies:

- process exit for short-lived PTY commands.
- adapter-specific sentinels inserted into prompts when safe.
- shell prompt markers for controlled PowerShell smoke tests.
- user action for manually supervised sessions.
- timeout and stale-output detection for degraded sessions.

The orchestrator must not infer task completion from a spinner disappearing, a color change, or a fragile terminal layout match.

## Error Handling

Process startup failure:

- Show agent status as error.
- Persist error in `runs` or session event log.
- Provide the exact command and working directory in diagnostics.

CLI not found:

- Show a clear setup error.
- Let the user edit the agent command path.

Read loop failure:

- Mark session degraded or exited.
- Keep previous logs available.

Backend mode mismatch:

- If an adapter requests `PipeBackend` but the command requires a TTY, fail the run with a setup diagnostic.
- If an adapter requests `PtyBackend`, make clear that stdout and stderr cannot be separated for that run.

UI thread safety:

- Backend threads must emit Qt signals.
- UI widgets must not be mutated from worker threads.

Database failure:

- Surface a blocking error.
- Do not continue orchestration without state persistence.

## Security Policy

Default behavior:

- Bind only to local desktop process. No network listener in V1.
- Store data under the project workspace or user app data directory.
- Dangerous CLI flags disabled by default.
- Each agent has an explicit `can_write_files` flag.
- Claude and Gemini default to read/review roles.
- User must confirm destructive actions or dangerous mode.

The app must make dangerous mode visible in the agent panel and run logs.

## Testing Strategy

Unit tests:

- Output normalizer and ANSI sanitizer.
- Backend mode selection.
- State transitions.
- Prompt builders.
- Agent command resolution.
- SQLite repository functions.

Integration tests:

- Start PowerShell PTY.
- Send echo command.
- Capture expected output.
- Run a pipe-backed command and capture stdout, stderr, and exit code.
- Persist session and run logs.

Manual acceptance tests:

- UI remains responsive while PTY streams output.
- Start and stop sessions repeatedly.
- Codex session can receive a prompt from the HMI.
- Raw logs and clean logs can be opened after session exit.

## Initial Project Structure

```text
agenthub/
  pyproject.toml
  README.md
  src/
    agenthub/
      main.py
      app.py
      ui/
        main.qml
        controllers.py
      core/
        orchestrator.py
        sessions.py
        agents.py
        tasks.py
        messages.py
        policy.py
      process/
        base.py
        pty_backend.py
        pipe_backend.py
        output.py
        screen.py
      adapters/
        base.py
        shell.py
        codex.py
        claude.py
        gemini.py
      storage/
        db.py
        schema.sql
        repositories.py
  tests/
    test_output.py
    test_process_backends.py
    test_state_machine.py
    test_storage.py
```

## MVP Acceptance Criteria

The V1 MVP is complete when:

1. The desktop app starts on Windows.
2. The user can create a PowerShell session.
3. The user can send text into the session.
4. PTY output appears in the HMI without freezing the UI.
5. Raw and clean logs are persisted.
6. A pipe-backed command can run to completion with stdout, stderr, and exit code persisted.
7. The user can configure and start a Codex session.
8. A manual prompt can be sent to Codex.
9. Codex output is saved into SQLite and visible in the run log panel.

## Open Decisions

These are deliberately postponed until after the MVP:

- Whether to keep QML or move to Qt Widgets for simpler maintenance.
- Whether to replace pywinpty with a Rust/C++ PTY service.
- Whether to replace the simple ANSI sanitizer with `pyte` immediately or after the PTY smoke test.
- Whether autonomous multi-agent progression should run without user approval.
- Whether to package with PyInstaller or Nuitka.
- Whether to add a local HTTP API for external integrations.
