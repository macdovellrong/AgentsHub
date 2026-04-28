# AgentHub Shared Chat Multi-Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-version HMI where PowerShell, Codex, Claude, and Gemini can run in parallel in one workspace and communicate through one shared chat timeline with `@agent` routing.

**Architecture:** Split chat/routing primitives out of `MainWindow`, add a per-profile `AgentSessionState`, then refactor the HMI from a single active terminal into a session map drained by one timer. The UI keeps independent per-run logs/indexes while the center timeline becomes a live display view over all user, agent, and system messages.

**Tech Stack:** Python 3.11, PySide6 widgets, existing `InteractivePtySession`, `OutputBuffer`, `RunLogWriter`, `RunIndexStore`, pytest.

---

## File Structure

- Create `src/agenthub/ui/chat.py`
  - Owns `ChatMessageKind`, `ChatMessage`, `RoutedInput`, `parse_routed_input()`, and `format_chat_message()`.
  - This file has no Qt dependency and is easy to unit test.
- Create `src/agenthub/ui/agent_session.py`
  - Owns `AgentSessionStatus` and `AgentSessionState`.
  - Holds runtime resources for one profile: PTY session, output buffer, log writer, run index store, run id.
- Modify `src/agenthub/ui/main_window.py`
  - Replace single `_session`, `_log_writer`, `_output_buffer`, `_active_profile`, `_active_run_id`, `_run_index_store` fields with `_agent_states: dict[str, AgentSessionState]`.
  - Replace selected-terminal center with shared chat timeline.
  - Add roster list and start/stop controls for selected profile.
  - Drain all live sessions on the existing timer.
  - Route input via optional `@agent` prefix.
- Modify `tests/test_main_window.py`
  - Update tests that assume single-session fields.
  - Add multi-agent, shared chat, routing, offline/unknown route, and workspace lock tests.
- Create `tests/test_chat.py`
  - Unit tests for route parsing and chat formatting.
- Update `README.md`
  - Briefly document shared chat and `@agent` routing.

---

### Task 1: Chat Routing And Message Model

**Files:**
- Create: `src/agenthub/ui/chat.py`
- Create: `tests/test_chat.py`

- [ ] **Step 1: Write failing tests for route parsing and display formatting**

Create `tests/test_chat.py`:

```python
from agenthub.ui.chat import (
    ChatMessage,
    ChatMessageKind,
    format_chat_message,
    parse_routed_input,
)


def test_parse_routed_input_extracts_known_agent_prefix():
    routed = parse_routed_input(
        "@codex implement the parser",
        known_agent_ids={"codex", "claude", "gemini", "powershell"},
        default_agent_id="codex",
    )

    assert routed.target_agent_id == "codex"
    assert routed.text == "implement the parser"
    assert routed.error_message is None


def test_parse_routed_input_uses_default_without_prefix():
    routed = parse_routed_input(
        "run tests",
        known_agent_ids={"codex", "claude"},
        default_agent_id="claude",
    )

    assert routed.target_agent_id == "claude"
    assert routed.text == "run tests"
    assert routed.error_message is None


def test_parse_routed_input_rejects_unknown_agent_prefix():
    routed = parse_routed_input(
        "@reviewer inspect this",
        known_agent_ids={"codex", "gemini"},
        default_agent_id="codex",
    )

    assert routed.target_agent_id is None
    assert routed.text == "inspect this"
    assert routed.error_message == "未知 Agent: reviewer"


def test_parse_routed_input_rejects_empty_message_after_prefix():
    routed = parse_routed_input(
        "@gemini",
        known_agent_ids={"gemini"},
        default_agent_id="gemini",
    )

    assert routed.target_agent_id is None
    assert routed.text == ""
    assert routed.error_message == "消息不能为空"


def test_format_chat_message_includes_sender_and_text():
    message = ChatMessage(
        sender_id="codex",
        sender_name="Codex",
        text="Implemented task 1",
        kind=ChatMessageKind.AGENT,
        timestamp="2026-04-28T10:00:00+08:00",
    )

    assert format_chat_message(message) == (
        "[10:00:00] Codex\nImplemented task 1"
    )
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
.\.venv\Scripts\python -m pytest tests\test_chat.py -v
```

Expected: collection fails with `ModuleNotFoundError: No module named 'agenthub.ui.chat'`.

- [ ] **Step 3: Implement chat primitives**

Create `src/agenthub/ui/chat.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum


class ChatMessageKind(StrEnum):
    USER = "user"
    AGENT = "agent"
    SYSTEM = "system"


@dataclass(frozen=True)
class ChatMessage:
    sender_id: str
    sender_name: str
    text: str
    kind: ChatMessageKind
    timestamp: str


@dataclass(frozen=True)
class RoutedInput:
    target_agent_id: str | None
    text: str
    error_message: str | None = None


def parse_routed_input(
    text: str,
    *,
    known_agent_ids: set[str],
    default_agent_id: str,
) -> RoutedInput:
    stripped = text.strip()
    if not stripped:
        return RoutedInput(
            target_agent_id=None,
            text="",
            error_message="消息不能为空",
        )
    if not stripped.startswith("@"):
        return RoutedInput(target_agent_id=default_agent_id, text=stripped)

    route, separator, remainder = stripped.partition(" ")
    target = route[1:].strip().lower()
    message = remainder.strip()
    if target not in known_agent_ids:
        return RoutedInput(
            target_agent_id=None,
            text=message,
            error_message=f"未知 Agent: {target}",
        )
    if not separator or not message:
        return RoutedInput(
            target_agent_id=None,
            text="",
            error_message="消息不能为空",
        )
    return RoutedInput(target_agent_id=target, text=message)


def new_chat_message(
    *,
    sender_id: str,
    sender_name: str,
    text: str,
    kind: ChatMessageKind,
) -> ChatMessage:
    return ChatMessage(
        sender_id=sender_id,
        sender_name=sender_name,
        text=text,
        kind=kind,
        timestamp=datetime.now(timezone.utc).astimezone().isoformat(),
    )


def format_chat_message(message: ChatMessage) -> str:
    timestamp = _format_time(message.timestamp)
    return f"[{timestamp}] {message.sender_name}\n{message.text}"


def _format_time(value: str) -> str:
    try:
        return datetime.fromisoformat(value).strftime("%H:%M:%S")
    except ValueError:
        return value
```

- [ ] **Step 4: Run chat tests**

Run:

```powershell
.\.venv\Scripts\python -m pytest tests\test_chat.py -v
```

Expected: `5 passed`.

- [ ] **Step 5: Commit**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add src/agenthub/ui/chat.py tests/test_chat.py
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: add chat routing model"
```

---

### Task 2: Agent Session State Model

**Files:**
- Create: `src/agenthub/ui/agent_session.py`
- Modify: `tests/test_main_window.py`

- [ ] **Step 1: Write failing test for per-profile session state construction**

Append to `tests/test_main_window.py`:

```python
from agenthub.ui.agent_session import AgentSessionStatus, create_agent_states


def test_create_agent_states_initializes_each_profile_independently():
    app = QApplication.instance() or QApplication([])
    window = MainWindow()
    try:
        states = create_agent_states(window._profiles)

        assert set(states) == {"powershell", "codex", "claude", "gemini"}
        assert states["codex"].profile.id == "codex"
        assert states["codex"].status == AgentSessionStatus.OFFLINE
        assert states["codex"].session is None
        assert states["codex"].run_id is None
        assert states["codex"].output_buffer.snapshot() == ""
    finally:
        window.close()
        app.processEvents()
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```powershell
.\.venv\Scripts\python -m pytest tests\test_main_window.py::test_create_agent_states_initializes_each_profile_independently -v
```

Expected: collection fails with `ModuleNotFoundError: No module named 'agenthub.ui.agent_session'`.

- [ ] **Step 3: Implement session state model**

Create `src/agenthub/ui/agent_session.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from agenthub.adapters.profiles import AgentProfile
from agenthub.process.interactive_pty import InteractivePtySession
from agenthub.storage.run_index import RunIndexStore
from agenthub.storage.run_logs import RunLogWriter
from agenthub.ui.output_buffer import OutputBuffer


class AgentSessionStatus(StrEnum):
    OFFLINE = "offline"
    STARTING = "starting"
    RUNNING = "running"
    EXITED = "exited"
    STOPPED = "stopped"
    START_FAILED = "start_failed"


@dataclass
class AgentSessionState:
    profile: AgentProfile
    session: InteractivePtySession | None
    output_buffer: OutputBuffer
    log_writer: RunLogWriter | None
    run_index_store: RunIndexStore | None
    run_id: str | None
    status: AgentSessionStatus

    def is_alive(self) -> bool:
        return self.session is not None and self.session.is_alive()


def create_agent_states(
    profiles: tuple[AgentProfile, ...],
) -> dict[str, AgentSessionState]:
    return {
        profile.id: AgentSessionState(
            profile=profile,
            session=None,
            output_buffer=OutputBuffer(max_chars=200_000),
            log_writer=None,
            run_index_store=None,
            run_id=None,
            status=AgentSessionStatus.OFFLINE,
        )
        for profile in profiles
    }
```

- [ ] **Step 4: Run the new test**

Run:

```powershell
.\.venv\Scripts\python -m pytest tests\test_main_window.py::test_create_agent_states_initializes_each_profile_independently -v
```

Expected: `1 passed`.

- [ ] **Step 5: Commit**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add src/agenthub/ui/agent_session.py tests/test_main_window.py
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: add agent session state model"
```

---

### Task 3: Refactor HMI Layout To Roster And Shared Timeline

**Files:**
- Modify: `src/agenthub/ui/main_window.py`
- Modify: `tests/test_main_window.py`

- [ ] **Step 1: Write failing layout test**

Replace `test_main_window_applies_operational_layout_and_terminal_style` in `tests/test_main_window.py` with:

```python
def test_main_window_applies_shared_chat_layout():
    app = QApplication.instance() or QApplication([])
    window = MainWindow()
    try:
        assert window.agent_list.objectName() == "agentRoster"
        assert window.chat_timeline.objectName() == "chatTimeline"
        assert window._workspace_splitter.count() == 3
        assert "QPlainTextEdit#chatTimeline" in window.styleSheet()
        assert [window.agent_list.item(index).text().split()[0] for index in range(4)] == [
            "PowerShell",
            "Codex",
            "Claude",
            "Gemini",
        ]
    finally:
        window.close()
        app.processEvents()
```

- [ ] **Step 2: Run layout test to verify it fails**

Run:

```powershell
.\.venv\Scripts\python -m pytest tests\test_main_window.py::test_main_window_applies_shared_chat_layout -v
```

Expected: FAIL with `AttributeError: 'MainWindow' object has no attribute 'agent_list'`.

- [ ] **Step 3: Add shared chat widgets and roster without changing session behavior**

In `src/agenthub/ui/main_window.py`:

1. Import `create_agent_states`:

```python
from agenthub.ui.agent_session import create_agent_states
```

2. In `__init__`, after `_profiles` assignment, initialize states and default agent:

```python
self._agent_states = create_agent_states(self._profiles)
self._default_agent_id = "codex"
```

3. Replace `self.terminal = TerminalPane()` block with a read-only chat timeline:

```python
self.chat_timeline = QPlainTextEdit()
self.chat_timeline.setObjectName("chatTimeline")
self.chat_timeline.setReadOnly(True)
self.chat_timeline.setFont(QFont("Consolas", 10))
self.chat_timeline.setLineWrapMode(QPlainTextEdit.LineWrapMode.WidgetWidth)
self.chat_timeline.setPlaceholderText("Agent 输出会显示在这里")
self.terminal = self.chat_timeline
```

Keeping `self.terminal` as an alias preserves existing history-log tests during the refactor.

4. Add a roster list:

```python
self.agent_list = QListWidget()
self.agent_list.setObjectName("agentRoster")
self.agent_list.setMinimumWidth(180)
self.agent_list.currentRowChanged.connect(self._select_agent_row)
```

5. Build the left panel as roster plus start/stop controls:

```python
agent_bar = QHBoxLayout()
agent_bar.addWidget(QLabel("Agent"))
agent_bar.addStretch(1)
agent_bar.addWidget(self.start_button)
agent_bar.addWidget(self.stop_button)

left_layout.addLayout(agent_bar)
left_layout.addWidget(self.agent_list, 1)
left_layout.addLayout(task_bar)
left_layout.addLayout(task_board)
```

6. Remove `agent_combo` from the top bar visually, but leave it available for compatibility tests until Task 4:

```python
self.agent_combo.hide()
```

7. Use chat timeline in terminal panel:

```python
terminal_layout.addWidget(QLabel("共享聊天"))
terminal_layout.addWidget(self.chat_timeline, 1)
terminal_layout.addLayout(input_bar)
```

8. Add roster refresh helpers:

```python
def _refresh_agent_roster(self) -> None:
    current = self.agent_list.currentRow()
    self.agent_list.blockSignals(True)
    self.agent_list.clear()
    for profile in self._profiles:
        state = self._agent_states[profile.id]
        self.agent_list.addItem(f"{profile.display_name}  {state.status.value}")
    self.agent_list.blockSignals(False)
    if self.agent_list.count() > 0:
        self.agent_list.setCurrentRow(max(0, current))

def _select_agent_row(self, row: int) -> None:
    if 0 <= row < len(self._profiles):
        self.agent_combo.setCurrentIndex(row)
        self._sync_agent_placeholder()
        self._sync_controls()
```

Call `_refresh_agent_roster()` before `_sync_controls()` in `__init__`.

9. Update stylesheet selector from `terminalPane` to `chatTimeline`:

```css
QPlainTextEdit#chatTimeline {
    background: #070a0d;
    color: #d8f3dc;
    border: 1px solid #28313d;
    border-radius: 6px;
    padding: 8px;
    selection-background-color: #2f5d46;
}
```

- [ ] **Step 4: Run layout and existing HMI tests**

Run:

```powershell
.\.venv\Scripts\python -m pytest tests\test_main_window.py -v
```

Expected: existing tests may still fail where they expect direct terminal key input. The layout test must pass before moving to Task 4.

- [ ] **Step 5: Commit**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add src/agenthub/ui/main_window.py tests/test_main_window.py
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: add shared chat layout"
```

---

### Task 4: Multi-Agent Start, Stop, Drain, And Logging

**Files:**
- Modify: `src/agenthub/ui/main_window.py`
- Modify: `tests/test_main_window.py`

- [ ] **Step 1: Write failing test for starting two different agents independently**

Add to `tests/test_main_window.py`:

```python
def test_main_window_starts_multiple_different_agent_sessions(tmp_path):
    app = QApplication.instance() or QApplication([])
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    window = MainWindow(workspace_path=workspace)

    class FakeSession:
        def __init__(self, profile_id):
            self.profile_id = profile_id
            self.alive = False
            self.writes = []

        def start(self):
            self.alive = True

        def write(self, text):
            self.writes.append(text)

        def drain(self):
            return []

        def is_alive(self):
            return self.alive

        def stop(self):
            self.alive = False

    created = []

    def fake_create_session(profile, run_id=None):
        session = FakeSession(profile.id)
        created.append(session)
        return session

    window._create_session = fake_create_session
    try:
        window.agent_list.setCurrentRow(0)
        window.start_session()
        window.agent_list.setCurrentRow(1)
        window.start_session()

        assert window._agent_states["powershell"].is_alive()
        assert window._agent_states["codex"].is_alive()
        assert len(created) == 2
        records = RunIndexStore.for_workspace(workspace).list_records()
        assert sorted(record.profile_id for record in records) == ["codex", "powershell"]
    finally:
        window.close()
        app.processEvents()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
.\.venv\Scripts\python -m pytest tests\test_main_window.py::test_main_window_starts_multiple_different_agent_sessions -v
```

Expected: FAIL because current `start_session()` still uses a single `_session`.

- [ ] **Step 3: Refactor start_session() to target selected state**

In `src/agenthub/ui/main_window.py`, add helpers:

```python
def selected_profile_id(self) -> str:
    return self.selected_profile().id

def selected_agent_state(self):
    return self._agent_states[self.selected_profile_id()]

def _any_session_alive(self) -> bool:
    return any(state.is_alive() for state in self._agent_states.values())
```

Replace `start_session()` with a state-based version:

```python
def start_session(self) -> None:
    state = self.selected_agent_state()
    if state.is_alive():
        return
    profile = state.profile
    try:
        state.log_writer = RunLogWriter.create(
            root=self._log_root,
            profile_id=profile.id,
        )
        state.run_index_store = RunIndexStore.for_workspace(self._workspace_path)
        state.run_id = state.log_writer.paths.run_id
        state.run_index_store.create_run(
            profile_id=profile.id,
            profile_name=profile.display_name,
            workspace_path=self._workspace_path,
            log_paths=state.log_writer.paths,
            status=RunStatus.STARTING,
        )
        state.status = AgentSessionStatus.STARTING
    except Exception as exc:
        self._append_system_message(f"{profile.display_name} 运行记录启动失败: {exc}")
        self._sync_controls()
        return

    state.session = self._create_session(profile, run_id=state.run_id)
    try:
        state.session.start()
    except Exception as exc:
        self._finish_agent_run(state, RunStatus.START_FAILED, error_message=str(exc))
        state.session = None
        state.status = AgentSessionStatus.START_FAILED
        self._append_system_message(f"{profile.display_name} 启动失败: {exc}")
        self._refresh_agent_roster()
        self._sync_controls()
        return

    self._mark_agent_run(state, RunStatus.RUNNING)
    state.status = AgentSessionStatus.RUNNING
    state.output_buffer.reset()
    self._append_system_message(f"{profile.display_name} 已启动，日志目录: {state.log_writer.paths.run_dir}")
    self.refresh_run_history()
    self._flush_timer.start()
    self._refresh_agent_roster()
    self._sync_controls()
```

Import `AgentSessionStatus`:

```python
from agenthub.ui.agent_session import AgentSessionStatus, create_agent_states
```

- [ ] **Step 4: Refactor stop_session(), run helpers, and closeEvent()**

Replace `_mark_active_run`, `_finish_active_run`, `_cleanup_inactive_run` with state-based helpers:

```python
def _mark_agent_run(
    self,
    state,
    status: RunStatus,
    *,
    error_message: str | None = None,
) -> None:
    if state.run_index_store is None or state.run_id is None:
        return
    try:
        state.run_index_store.update_status(
            state.run_id,
            status,
            error_message=error_message,
        )
    except Exception as exc:
        self._append_system_message(
            f"{state.profile.display_name} 运行记录更新失败: {exc}"
        )

def _finish_agent_run(
    self,
    state,
    status: RunStatus,
    *,
    error_message: str | None = None,
) -> None:
    self._mark_agent_run(state, status, error_message=error_message)
    if state.log_writer is not None:
        state.log_writer.close()
        state.log_writer = None
    state.run_index_store = None
    state.run_id = None
    self.refresh_run_history()
```

Replace `stop_session()`:

```python
def stop_session(self) -> None:
    state = self.selected_agent_state()
    if state.session is None:
        return
    try:
        if state.session.is_alive() and state.profile.id == "powershell":
            state.session.write("exit\r\n")
    finally:
        state.session.stop()
        self._drain_agent_state(state, mark_exited=False)
        state.session = None
        state.status = AgentSessionStatus.STOPPED
        self._finish_agent_run(state, RunStatus.STOPPED)
        if not self._any_session_alive():
            self._flush_timer.stop()
        self._refresh_agent_roster()
        self._sync_controls()
```

Replace `closeEvent()`:

```python
def closeEvent(self, event) -> None:  # noqa: N802
    for state in self._agent_states.values():
        if state.session is not None:
            if state.session.is_alive():
                state.session.stop()
            self._finish_agent_run(state, RunStatus.STOPPED)
            state.session = None
            state.status = AgentSessionStatus.STOPPED
    super().closeEvent(event)
```

- [ ] **Step 5: Implement drain loop over all live sessions**

Replace `_drain_session()` with:

```python
def _drain_session(self, mark_exited: bool = True) -> None:
    for state in self._agent_states.values():
        self._drain_agent_state(state, mark_exited=mark_exited)
    if not self._any_session_alive():
        self._flush_timer.stop()
    self._sync_controls()

def _drain_agent_state(self, state, mark_exited: bool = True) -> None:
    if state.session is None:
        return
    for event in state.session.drain():
        if state.log_writer is not None:
            state.log_writer.append(event)
        state.output_buffer.append(event)
    if state.output_buffer.has_pending_snapshot():
        self._append_agent_snapshot(state)
    if not state.session.is_alive():
        if mark_exited:
            self._finish_agent_run(state, RunStatus.EXITED)
        state.status = AgentSessionStatus.EXITED
        state.session = None
        self._append_system_message(f"{state.profile.display_name} 进程已退出")
        self._refresh_agent_roster()
```

Implement timeline append helpers:

```python
def _append_agent_snapshot(self, state) -> None:
    text = state.output_buffer.snapshot()
    if text:
        self._append_chat_message(
            sender_id=state.profile.id,
            sender_name=state.profile.display_name,
            text=text,
            kind=ChatMessageKind.AGENT,
        )

def _append_system_message(self, text: str) -> None:
    self._append_chat_message(
        sender_id="system",
        sender_name="System",
        text=text,
        kind=ChatMessageKind.SYSTEM,
    )

def _append_chat_message(
    self,
    *,
    sender_id: str,
    sender_name: str,
    text: str,
    kind: ChatMessageKind,
) -> None:
    message = new_chat_message(
        sender_id=sender_id,
        sender_name=sender_name,
        text=text,
        kind=kind,
    )
    self.chat_timeline.appendPlainText(format_chat_message(message))
    self.chat_timeline.appendPlainText("")
    self.chat_timeline.moveCursor(QTextCursor.MoveOperation.End)
```

Import chat helpers:

```python
from agenthub.ui.chat import ChatMessageKind, format_chat_message, new_chat_message
```

- [ ] **Step 6: Run multi-session tests**

Run:

```powershell
.\.venv\Scripts\python -m pytest tests\test_main_window.py::test_main_window_starts_multiple_different_agent_sessions -v
```

Expected: `1 passed`.

- [ ] **Step 7: Run all HMI tests and fix renamed expectations**

Run:

```powershell
.\.venv\Scripts\python -m pytest tests\test_main_window.py -v
```

Expected: tests tied to `window._session`, `_log_writer`, and `terminal` will fail. Update them to use `window._agent_states["powershell"]` or the relevant profile state. Keep the behavioral assertions:

- raw/clean logs still written.
- run index still records start/stop/exit/start_failed.
- history logs still load into `chat_timeline`.
- workspace default log root still works.

- [ ] **Step 8: Commit**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add src/agenthub/ui/main_window.py tests/test_main_window.py
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: support multiple agent sessions"
```

---

### Task 5: `@agent` Input Routing In Shared Chat

**Files:**
- Modify: `src/agenthub/ui/main_window.py`
- Modify: `tests/test_main_window.py`

- [ ] **Step 1: Write failing tests for routed sends**

Add to `tests/test_main_window.py`:

```python
def test_main_window_routes_at_agent_input_without_switching_view(tmp_path):
    app = QApplication.instance() or QApplication([])
    window = MainWindow(log_root=tmp_path)

    class FakeSession:
        def __init__(self):
            self.writes = []

        def write(self, text):
            self.writes.append(text)

        def is_alive(self):
            return True

        def drain(self):
            return []

        def stop(self):
            pass

    codex = FakeSession()
    gemini = FakeSession()
    window._agent_states["codex"].session = codex
    window._agent_states["codex"].status = AgentSessionStatus.RUNNING
    window._agent_states["gemini"].session = gemini
    window._agent_states["gemini"].status = AgentSessionStatus.RUNNING
    try:
        window.agent_list.setCurrentRow(1)
        window.command_input.setText("@gemini review current diff")

        window.send_command()

        assert codex.writes == []
        assert gemini.writes == ["review current diff\r\n"]
        assert "你 -> Gemini" in window.chat_timeline.toPlainText()
        assert "review current diff" in window.chat_timeline.toPlainText()
        assert window.agent_list.currentRow() == 1
    finally:
        window.close()
        app.processEvents()


def test_main_window_rejects_unknown_or_offline_routed_agent(tmp_path):
    app = QApplication.instance() or QApplication([])
    window = MainWindow(log_root=tmp_path)
    try:
        window.command_input.setText("@reviewer inspect")
        window.send_command()
        assert "未知 Agent: reviewer" in window.chat_timeline.toPlainText()

        window.command_input.setText("@codex implement")
        window.send_command()
        assert "Codex 未启动" in window.chat_timeline.toPlainText()
    finally:
        window.close()
        app.processEvents()
```

- [ ] **Step 2: Run routed-send tests to verify they fail**

Run:

```powershell
.\.venv\Scripts\python -m pytest tests\test_main_window.py::test_main_window_routes_at_agent_input_without_switching_view tests\test_main_window.py::test_main_window_rejects_unknown_or_offline_routed_agent -v
```

Expected: FAIL because `send_command()` still sends to selected single session or does not parse routes.

- [ ] **Step 3: Implement routed send_command()**

In `src/agenthub/ui/main_window.py`, import:

```python
from agenthub.ui.chat import (
    ChatMessageKind,
    format_chat_message,
    new_chat_message,
    parse_routed_input,
)
```

Replace `send_command()`:

```python
def send_command(self) -> None:
    text = self.command_input.text()
    routed = parse_routed_input(
        text,
        known_agent_ids=set(self._agent_states),
        default_agent_id=self._default_agent_id,
    )
    if routed.error_message is not None:
        self._append_system_message(routed.error_message)
        self.command_input.clear()
        return

    target_id = routed.target_agent_id
    if target_id is None:
        self._append_system_message("没有可用的目标 Agent")
        self.command_input.clear()
        return

    state = self._agent_states[target_id]
    if not state.is_alive():
        self._append_system_message(f"{state.profile.display_name} 未启动")
        self.command_input.clear()
        return

    state.session.write(routed.text + "\r\n")
    self._append_chat_message(
        sender_id="user",
        sender_name=f"你 -> {state.profile.display_name}",
        text=routed.text,
        kind=ChatMessageKind.USER,
    )
    self.command_input.clear()
```

Set input placeholder after controls initialize:

```python
self.command_input.setPlaceholderText(
    "输入消息，或用 @codex / @claude / @gemini / @powershell 定向发送"
)
```

Remove `_write_terminal_input()` and direct keyboard capture if the chat timeline no longer sends raw terminal keystrokes.

- [ ] **Step 4: Update control sync for shared input**

In `_sync_controls()`:

```python
selected_state = self.selected_agent_state()
any_alive = self._any_session_alive()
self.choose_workspace_button.setEnabled(not any_alive)
self.recent_workspace_combo.setEnabled(
    not any_alive and self.recent_workspace_combo.count() > 0
)
self.start_button.setEnabled(not selected_state.is_alive())
self.stop_button.setEnabled(selected_state.is_alive())
self.command_input.setEnabled(any_alive)
self.send_button.setEnabled(any_alive)
```

Keep `agent_combo` compatibility if still present, but do not use it as a visible selector.

- [ ] **Step 5: Run routing tests**

Run:

```powershell
.\.venv\Scripts\python -m pytest tests\test_main_window.py::test_main_window_routes_at_agent_input_without_switching_view tests\test_main_window.py::test_main_window_rejects_unknown_or_offline_routed_agent -v
```

Expected: `2 passed`.

- [ ] **Step 6: Commit**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add src/agenthub/ui/main_window.py tests/test_main_window.py
& 'C:\Program Files\Git\cmd\git.exe' commit -m "feat: route shared chat input"
```

---

### Task 6: Preserve Task Board, History Runs, And Workspace Lock Behavior

**Files:**
- Modify: `src/agenthub/ui/main_window.py`
- Modify: `tests/test_main_window.py`

- [ ] **Step 1: Write failing workspace lock and history compatibility tests**

Add to `tests/test_main_window.py`:

```python
def test_main_window_disables_workspace_controls_while_any_agent_is_alive(tmp_path):
    app = QApplication.instance() or QApplication([])
    window = MainWindow(workspace_path=tmp_path)

    class FakeSession:
        def is_alive(self):
            return True

        def drain(self):
            return []

        def stop(self):
            pass

    window._agent_states["claude"].session = FakeSession()
    window._agent_states["claude"].status = AgentSessionStatus.RUNNING
    try:
        window._sync_controls()

        assert not window.choose_workspace_button.isEnabled()
        assert not window.recent_workspace_combo.isEnabled()
        assert window.command_input.isEnabled()
        assert window.send_button.isEnabled()
    finally:
        window.close()
        app.processEvents()


def test_main_window_history_log_loads_into_shared_chat_timeline(tmp_path):
    app = QApplication.instance() or QApplication([])
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _create_indexed_run(
        workspace,
        run_id="codex-run",
        profile_id="codex",
        profile_name="Codex",
        clean_text="CLEAN LOG\n",
        raw_text="\x1b[32mRAW LOG\x1b[0m\n",
    )

    window = MainWindow(workspace_path=workspace)
    try:
        window.refresh_run_history()
        window.history_list.setCurrentRow(0)

        window.load_selected_clean_log()
        assert window.chat_timeline.toPlainText() == "CLEAN LOG\n"
    finally:
        window.close()
        app.processEvents()
```

- [ ] **Step 2: Run compatibility tests to verify current failures**

Run:

```powershell
.\.venv\Scripts\python -m pytest tests\test_main_window.py::test_main_window_disables_workspace_controls_while_any_agent_is_alive tests\test_main_window.py::test_main_window_history_log_loads_into_shared_chat_timeline -v
```

Expected: at least the workspace lock test fails until `_sync_controls()` is fully state-map based.

- [ ] **Step 3: Remove stale single-session state fields and helpers**

In `MainWindow.__init__`, delete these fields:

```python
self._log_writer
self._run_index_store
self._active_run_id
self._active_profile
self._session
self._output_buffer
```

Ensure all references were replaced with `_agent_states[...]`.

- [ ] **Step 4: Keep history loading compatible**

In `_load_selected_history_log()`:

```python
self.chat_timeline.setPlainText(text)
self.chat_timeline.moveCursor(QTextCursor.MoveOperation.End)
```

If `self.terminal` alias remains, keep it pointing to `self.chat_timeline`.

- [ ] **Step 5: Keep task board methods unchanged**

Run:

```powershell
.\.venv\Scripts\python -m pytest tests\test_main_window.py::test_main_window_groups_tasks_by_status tests\test_main_window.py::test_main_window_refreshes_tasks_after_workspace_change -v
```

Expected: `2 passed`.

- [ ] **Step 6: Run full HMI test file**

Run:

```powershell
.\.venv\Scripts\python -m pytest tests\test_main_window.py -v
```

Expected: all HMI tests pass.

- [ ] **Step 7: Commit**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add src/agenthub/ui/main_window.py tests/test_main_window.py
& 'C:\Program Files\Git\cmd\git.exe' commit -m "fix: preserve hmi panels with multi-agent chat"
```

---

### Task 7: Documentation And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Update README with shared chat usage**

Add after the HMI startup section in `README.md`:

```markdown
The HMI uses a shared chat timeline for live agents. Start each agent from the
left roster, then send messages from the input box. Use `@codex`, `@claude`,
`@gemini`, or `@powershell` to route a message without switching the timeline.
Each agent still writes its own run logs under `.agenthub/runs/`.
```

- [ ] **Step 2: Update AGENTS.md completed tasks**

Add to the completed task list in `AGENTS.md`:

```markdown
- 共享聊天式多 Agent HMI：同一 workspace 下并行运行不同 Agent，并通过 `@agent` 定向发送。
```

- [ ] **Step 3: Run full test suite**

Run:

```powershell
.\.venv\Scripts\python -m pytest -v
```

Expected: all tests pass. The count should be higher than the current 68 because `tests/test_chat.py` and new HMI tests were added.

- [ ] **Step 4: Run compile check**

Run:

```powershell
.\.venv\Scripts\python -m py_compile src\agenthub\ui\chat.py src\agenthub\ui\agent_session.py src\agenthub\ui\main_window.py
```

Expected: exit code `0`.

- [ ] **Step 5: Run diff check**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' diff --check
```

Expected: exit code `0`, with only possible LF/CRLF warnings.

- [ ] **Step 6: Commit docs and final cleanup**

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add README.md AGENTS.md
& 'C:\Program Files\Git\cmd\git.exe' commit -m "docs: describe shared chat multi-agent hmi"
```

- [ ] **Step 7: Final status check**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' status --short
```

Expected: no output.

---

## Self-Review

Spec coverage:

- Multiple different agents in one workspace: Task 4.
- Shared chat timeline: Task 3 and Task 5.
- `@agent` routing without switching view: Task 1 and Task 5.
- Per-agent independent PTY/log/run index: Task 2 and Task 4.
- Workspace switching disabled while any session alive: Task 6.
- Error handling for unknown/offline/start failure/exited: Task 4, Task 5, Task 6.
- Existing task board/history/run logging preserved: Task 6.

Scope exclusions are preserved:

- No same-profile multi-open.
- No role prompt editor.
- No autonomous agent-to-agent routing.
- No write locks or worktree isolation.
- No rich chat rendering beyond a functional timeline.

No placeholder steps are present. The plan uses concrete file paths, function names, commands, expected failures, and expected pass states.
