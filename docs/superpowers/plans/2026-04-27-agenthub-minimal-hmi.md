# AgentHub Minimal HMI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal Windows desktop HMI that can start a PowerShell ConPTY session, send commands, and display output with batched UI updates.

**Architecture:** Keep PTY control independent from Qt. `InteractivePtySession` owns pywinpty lifecycle and exposes queue-based output draining; `OutputBuffer` batches clean text before the UI flushes it; PySide6 modules only compose these pieces into a small Qt Widgets window. This avoids binding backend tests to GUI availability.

**Tech Stack:** Python 3.11+, pywinpty, PySide6 Qt Widgets, pytest.

---

## File Structure

- `src/agenthub/process/interactive_pty.py`: persistent PTY session with reader thread, write, drain, and stop methods.
- `src/agenthub/ui/output_buffer.py`: pure Python batching buffer for UI flushes.
- `src/agenthub/ui/main_window.py`: minimal PySide6 Qt Widgets HMI.
- `src/agenthub/ui/__init__.py`: UI package marker.
- `src/agenthub/main.py`: add `hmi` command while keeping `pipe-smoke`.
- `tests/test_output_buffer.py`: buffer behavior tests.
- `tests/test_interactive_pty.py`: PowerShell interactive PTY smoke test.

## Task 1: Output Buffer

**Files:**
- Create: `src/agenthub/ui/__init__.py`
- Create: `src/agenthub/ui/output_buffer.py`
- Create: `tests/test_output_buffer.py`

- [x] **Step 1: Write failing tests**

```python
from agenthub.process.base import OutputEvent, StreamName
from agenthub.ui.output_buffer import OutputBuffer


def test_output_buffer_flushes_clean_text_in_order():
    buffer = OutputBuffer()
    buffer.append(OutputEvent("run-1", StreamName.PTY, "raw-1", "A"))
    buffer.append(OutputEvent("run-1", StreamName.PTY, "raw-2", "B"))

    assert buffer.flush_text() == "AB"
    assert buffer.flush_text() == ""


def test_output_buffer_keeps_tail_when_limit_is_set():
    buffer = OutputBuffer(max_chars=5)
    buffer.append_text("123")
    buffer.append_text("4567")

    assert buffer.flush_text() == "34567"
```

- [x] **Step 2: Run tests to verify RED**

Run: `python -m pytest tests/test_output_buffer.py -v`

Expected: FAIL because `agenthub.ui.output_buffer` does not exist.

- [x] **Step 3: Implement minimal buffer**

Implement `OutputBuffer.append`, `append_text`, and `flush_text`.

- [x] **Step 4: Run tests to verify GREEN**

Run: `python -m pytest tests/test_output_buffer.py -v`

Expected: PASS.

## Task 2: Interactive PTY Session

**Files:**
- Create: `src/agenthub/process/interactive_pty.py`
- Create: `tests/test_interactive_pty.py`

- [x] **Step 1: Write failing test**

```python
import platform
import time

import pytest

from agenthub.process.interactive_pty import InteractivePtySession


pytestmark = pytest.mark.skipif(platform.system() != "Windows", reason="ConPTY is Windows-only")


def test_interactive_pty_session_writes_and_drains_output():
    session = InteractivePtySession(
        run_id="interactive-1",
        command=["powershell.exe", "-NoLogo", "-NoProfile"],
    )
    try:
        session.start()
        session.write("echo AGENTHUB_INTERACTIVE_OK\r\n")

        deadline = time.monotonic() + 15
        text = ""
        while time.monotonic() < deadline and "AGENTHUB_INTERACTIVE_OK" not in text:
            text += "".join(event.clean for event in session.drain())
            time.sleep(0.05)

        assert "AGENTHUB_INTERACTIVE_OK" in text
    finally:
        session.write("exit\r\n")
        session.stop()
```

- [x] **Step 2: Run tests to verify RED**

Run: `python -m pytest tests/test_interactive_pty.py -v`

Expected: FAIL because `InteractivePtySession` does not exist.

- [x] **Step 3: Implement session**

Implement `start`, `write`, `drain`, `stop`, and `is_alive` using `PtyProcess` and a daemon reader thread.

- [x] **Step 4: Run tests to verify GREEN**

Run: `python -m pytest tests/test_interactive_pty.py -v`

Expected: PASS.

## Task 3: Minimal Qt Widgets HMI

**Files:**
- Create: `src/agenthub/ui/main_window.py`
- Modify: `src/agenthub/main.py`
- Modify: `README.md`

- [x] **Step 1: Add HMI entrypoint**

Add `hmi` command to `agenthub.main`.

- [x] **Step 2: Implement minimal window**

Create a window with Start, Stop, command input, Send button, and read-only terminal output.

- [x] **Step 3: Add README command**

Document `python -m agenthub.main hmi`.

- [x] **Step 4: Verify imports and tests**

Run: `python -m pytest -v`

Expected: PASS.

## Self-Review Notes

- This plan covers only the HMI smoke layer. It does not include SQLite persistence, Codex session configuration, QML styling, or multi-agent orchestration.
- Backend logic remains testable without PySide6.
