# AgentHub Shared Chat Multi-Agent Design

## Goal

AgentHub should support multiple different agents running in the same workspace at the same time, with the center of the HMI acting as a shared chat timeline instead of a single selected terminal. Agents are treated as participants: the user, Codex, Claude, Gemini, and PowerShell all write into one conversation stream.

The first version supports one live session per agent profile. It does not support multiple Codex instances, automatic agent-to-agent forwarding, or worktree isolation.

## User Experience

The HMI layout becomes:

- Left: agent roster with profile name, status, and start/stop controls.
- Center: shared chat timeline showing all user and agent messages.
- Bottom center: one input box for user messages.
- Right: task board and historical runs.

Input routing uses an optional `@agent` prefix:

- `@codex implement the parser` sends `implement the parser` to Codex.
- `@claude split this requirement` sends to Claude.
- `@gemini review current diff` sends to Gemini.
- `@powershell dir` sends to PowerShell.
- Without an `@agent` prefix, input is sent to the default active agent. The initial default is Codex.

Sending to an agent must not switch the chat view. The timeline stays global.

## Session Model

Replace the single-session fields in `MainWindow` with a profile-keyed session map:

```python
@dataclass
class AgentSessionState:
    profile: AgentProfile
    session: InteractivePtySession | None
    output_buffer: OutputBuffer
    log_writer: RunLogWriter | None
    run_index_store: RunIndexStore | None
    run_id: str | None
    status: AgentSessionStatus
```

Only one session per profile is allowed in this version. Workspace switching is disabled while any session is alive.

## Chat Timeline

The timeline stores display events, not raw terminal streams:

```python
@dataclass
class ChatMessage:
    sender_id: str
    sender_name: str
    text: str
    kind: ChatMessageKind
    timestamp: str
```

User sends create `kind=user` messages. Agent output creates `kind=agent` messages. System errors, unknown `@agent`, and stopped-agent sends create `kind=system` messages.

PTY raw and clean logs remain per run. The chat timeline is an HMI view over live output, not the canonical log.

## Output Handling

The timer drains every active session. Each session keeps its own `OutputBuffer` and run log writer. When a session has a new screen snapshot, the HMI appends or updates a message block for that agent in the shared timeline.

The first implementation can append one message per drain tick. It does not need perfect chat-message segmentation from Codex/Claude/Gemini TUI output.

## Error Handling

- Unknown route, such as `@reviewer`, shows a system message and does not send.
- Sending to an offline agent shows a system message and does not auto-start it.
- Agent start failure is recorded in the run index and displayed as a system message.
- If an agent exits, its status changes to exited and the roster reflects it.

## Testing

Tests should cover:

- Multiple different profiles can be started and tracked independently.
- The drain loop reads all live sessions and appends agent-labeled timeline messages.
- `@agent` parsing routes input correctly.
- Unknown or offline `@agent` targets produce system messages.
- Workspace controls are disabled while any session is alive.
- Existing run logging, run indexing, task board, and history UI keep working.

## Non-Goals

- Multiple instances of the same agent profile.
- Automatic role prompt editing.
- Agent-to-agent autonomous routing.
- Shared write locks or git worktree isolation.
- Rich chat rendering beyond a functional shared timeline.
