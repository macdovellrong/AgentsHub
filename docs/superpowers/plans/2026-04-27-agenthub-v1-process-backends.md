# AgentHub V1 Process Backends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working slice of AgentHub: a Python package with output normalization, pipe-backed jobs, PTY-backed interactive sessions, and a minimal CLI smoke-test entrypoint.

**Architecture:** Core code talks to a `ProcessBackend` interface and does not know whether a process is backed by ConPTY or normal pipes. `PipeBackend` is used for deterministic headless CLI jobs with stdout/stderr separation; `PtyBackend` is used for interactive terminal sessions with a merged terminal stream. Output is normalized into structured events before it reaches storage or UI.

**Tech Stack:** Python 3.11+, PySide6, pywinpty, pytest.

---

## File Structure

- `pyproject.toml`: package metadata, dependencies, pytest configuration.
- `README.md`: first-run instructions for the Windows MVP.
- `src/agenthub/__init__.py`: package marker.
- `src/agenthub/process/base.py`: dataclasses, enums, and `ProcessBackend` protocol.
- `src/agenthub/process/output.py`: ANSI stripping and output event helpers.
- `src/agenthub/process/pipe_backend.py`: non-interactive subprocess runner.
- `src/agenthub/process/pty_backend.py`: pywinpty interactive session runner.
- `src/agenthub/main.py`: minimal CLI entrypoint for backend smoke tests.
- `tests/test_output.py`: output normalizer tests.
- `tests/test_pipe_backend.py`: pipe backend tests.
- `tests/test_pty_backend.py`: Windows pywinpty smoke test.

## Task 1: Project Scaffold

**Files:**
- Create: `pyproject.toml`
- Create: `README.md`
- Create: `src/agenthub/__init__.py`
- Create: `src/agenthub/process/__init__.py`

- [x] **Step 1: Create package metadata**

```toml
[project]
name = "agenthub"
version = "0.1.0"
description = "Windows desktop HMI for managing local CLI agents"
requires-python = ">=3.11"
dependencies = [
  "PySide6>=6.7",
  "pywinpty>=2.0",
]

[project.optional-dependencies]
dev = [
  "pytest>=8.0",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]
```

- [x] **Step 2: Add README with the first smoke commands**

````markdown
# AgentHub

Windows-only V1 desktop HMI for managing local CLI agents.

## Development

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
.\.venv\Scripts\python -m pytest
```
````

- [x] **Step 3: Verify test discovery**

Run: `python -m pytest`

Expected: pytest runs and reports no tests collected or all current tests passing.

## Task 2: Output Normalizer

**Files:**
- Create: `tests/test_output.py`
- Create: `src/agenthub/process/base.py`
- Create: `src/agenthub/process/output.py`

- [x] **Step 1: Write the failing tests**

```python
from agenthub.process.base import OutputEvent, StreamName
from agenthub.process.output import strip_ansi, normalize_chunk


def test_strip_ansi_removes_color_sequences():
    assert strip_ansi("\x1b[32mOK\x1b[0m") == "OK"


def test_normalize_chunk_keeps_raw_and_clean_text():
    event = normalize_chunk("run-1", StreamName.STDOUT, "\x1b[31mERR\x1b[0m")

    assert isinstance(event, OutputEvent)
    assert event.run_id == "run-1"
    assert event.stream == StreamName.STDOUT
    assert event.raw == "\x1b[31mERR\x1b[0m"
    assert event.clean == "ERR"
```

- [x] **Step 2: Run tests to verify RED**

Run: `python -m pytest tests/test_output.py -v`

Expected: FAIL because `agenthub.process.base` or `strip_ansi` does not exist.

- [x] **Step 3: Implement the minimal code**

```python
# src/agenthub/process/base.py
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class BackendMode(StrEnum):
    PTY = "pty"
    PIPE = "pipe"


class StreamName(StrEnum):
    PTY = "pty"
    STDOUT = "stdout"
    STDERR = "stderr"


@dataclass(frozen=True)
class OutputEvent:
    run_id: str
    stream: StreamName
    raw: str
    clean: str
```

```python
# src/agenthub/process/output.py
from __future__ import annotations

import re

from agenthub.process.base import OutputEvent, StreamName

ANSI_RE = re.compile(r"\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")


def strip_ansi(text: str) -> str:
    return ANSI_RE.sub("", text)


def normalize_chunk(run_id: str, stream: StreamName, chunk: str) -> OutputEvent:
    return OutputEvent(run_id=run_id, stream=stream, raw=chunk, clean=strip_ansi(chunk))
```

- [x] **Step 4: Run tests to verify GREEN**

Run: `python -m pytest tests/test_output.py -v`

Expected: PASS.

## Task 3: Pipe Backend

**Files:**
- Modify: `src/agenthub/process/base.py`
- Create: `src/agenthub/process/pipe_backend.py`
- Create: `tests/test_pipe_backend.py`

- [x] **Step 1: Write the failing tests**

```python
import sys

from agenthub.process.base import BackendMode, StreamName
from agenthub.process.pipe_backend import PipeBackend


def test_pipe_backend_captures_stdout_stderr_and_exit_code():
    backend = PipeBackend()

    result = backend.run(
        run_id="pipe-1",
        command=[
            sys.executable,
            "-c",
            "import sys; print('OUT'); print('ERR', file=sys.stderr)",
        ],
        cwd=None,
        timeout_seconds=10,
    )

    assert result.backend_mode == BackendMode.PIPE
    assert result.exit_code == 0
    assert result.stdout == "OUT\n"
    assert result.stderr == "ERR\n"
    assert [event.stream for event in result.events] == [StreamName.STDOUT, StreamName.STDERR]
```

- [x] **Step 2: Run tests to verify RED**

Run: `python -m pytest tests/test_pipe_backend.py -v`

Expected: FAIL because `PipeBackend` does not exist.

- [x] **Step 3: Implement the minimal code**

```python
# Add to src/agenthub/process/base.py
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence


Command = Sequence[str]


@dataclass(frozen=True)
class ProcessResult:
    run_id: str
    backend_mode: BackendMode
    command: Command
    cwd: Path | None
    exit_code: int
    stdout: str = ""
    stderr: str = ""
    events: list[OutputEvent] = field(default_factory=list)
```

```python
# src/agenthub/process/pipe_backend.py
from __future__ import annotations

import subprocess
from pathlib import Path

from agenthub.process.base import BackendMode, Command, ProcessResult, StreamName
from agenthub.process.output import normalize_chunk


class PipeBackend:
    def run(
        self,
        run_id: str,
        command: Command,
        cwd: Path | str | None,
        timeout_seconds: float,
    ) -> ProcessResult:
        completed = subprocess.run(
            list(command),
            cwd=str(cwd) if cwd is not None else None,
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
        )
        events = []
        if completed.stdout:
            events.append(normalize_chunk(run_id, StreamName.STDOUT, completed.stdout))
        if completed.stderr:
            events.append(normalize_chunk(run_id, StreamName.STDERR, completed.stderr))
        return ProcessResult(
            run_id=run_id,
            backend_mode=BackendMode.PIPE,
            command=command,
            cwd=Path(cwd) if cwd is not None else None,
            exit_code=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
            events=events,
        )
```

- [x] **Step 4: Run tests to verify GREEN**

Run: `python -m pytest tests/test_output.py tests/test_pipe_backend.py -v`

Expected: PASS.

## Task 4: PTY Backend Smoke Test

**Files:**
- Create: `src/agenthub/process/pty_backend.py`
- Create: `tests/test_pty_backend.py`

- [x] **Step 1: Write the failing test**

```python
import platform

import pytest

from agenthub.process.base import BackendMode, StreamName
from agenthub.process.pty_backend import PtyBackend


pytestmark = pytest.mark.skipif(platform.system() != "Windows", reason="ConPTY is Windows-only")


def test_pty_backend_runs_powershell_echo():
    backend = PtyBackend(cols=120, rows=40)

    result = backend.run_once(
        run_id="pty-1",
        command=["powershell.exe", "-NoLogo", "-NoProfile"],
        input_text="echo AGENTHUB_PTY_OK\r\nexit\r\n",
        cwd=None,
        timeout_seconds=15,
    )

    assert result.backend_mode == BackendMode.PTY
    assert result.exit_code == 0
    assert any(event.stream == StreamName.PTY for event in result.events)
    assert "AGENTHUB_PTY_OK" in result.stdout
```

- [x] **Step 2: Run tests to verify RED**

Run: `python -m pytest tests/test_pty_backend.py -v`

Expected: FAIL because `PtyBackend` does not exist.

- [x] **Step 3: Implement the minimal PTY runner**

```python
# src/agenthub/process/pty_backend.py
from __future__ import annotations

import time
from pathlib import Path

from winpty import PtyProcess

from agenthub.process.base import BackendMode, Command, ProcessResult, StreamName
from agenthub.process.output import normalize_chunk


class PtyBackend:
    def __init__(self, cols: int = 120, rows: int = 40) -> None:
        self.cols = cols
        self.rows = rows

    def run_once(
        self,
        run_id: str,
        command: Command,
        input_text: str,
        cwd: Path | str | None,
        timeout_seconds: float,
    ) -> ProcessResult:
        process = PtyProcess.spawn(
            list(command),
            dimensions=(self.rows, self.cols),
            cwd=str(cwd) if cwd is not None else None,
        )
        output = []
        deadline = time.monotonic() + timeout_seconds
        process.write(input_text)
        while time.monotonic() < deadline:
            try:
                chunk = process.read(4096)
            except EOFError:
                break
            if chunk:
                output.append(chunk)
            if not process.isalive():
                break
        if process.isalive():
            process.kill()
        text = "".join(output)
        return ProcessResult(
            run_id=run_id,
            backend_mode=BackendMode.PTY,
            command=command,
            cwd=Path(cwd) if cwd is not None else None,
            exit_code=process.exitstatus if process.exitstatus is not None else 0,
            stdout=text,
            events=[normalize_chunk(run_id, StreamName.PTY, text)] if text else [],
        )
```

- [x] **Step 4: Run tests to verify GREEN**

Run: `python -m pytest tests/test_output.py tests/test_pipe_backend.py tests/test_pty_backend.py -v`

Expected: PASS on Windows with pywinpty installed.

## Task 5: Smoke CLI Entrypoint

**Files:**
- Create: `src/agenthub/main.py`

- [x] **Step 1: Write the failing test**

```python
from agenthub.main import main


def test_main_pipe_smoke_returns_zero():
    assert main(["pipe-smoke"]) == 0
```

- [x] **Step 2: Run tests to verify RED**

Run: `python -m pytest tests/test_main.py -v`

Expected: FAIL because `agenthub.main` does not exist.

- [x] **Step 3: Implement the minimal entrypoint**

```python
# src/agenthub/main.py
from __future__ import annotations

import sys

from agenthub.process.pipe_backend import PipeBackend


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args == ["pipe-smoke"]:
        result = PipeBackend().run(
            run_id="pipe-smoke",
            command=[sys.executable, "-c", "print('AGENTHUB_PIPE_OK')"],
            cwd=None,
            timeout_seconds=10,
        )
        print(result.stdout, end="")
        return result.exit_code
    print("usage: python -m agenthub.main pipe-smoke", file=sys.stderr)
    return 2
```

- [x] **Step 4: Run tests to verify GREEN**

Run: `python -m pytest tests/test_main.py tests/test_pipe_backend.py tests/test_output.py -v`

Expected: PASS.

## Self-Review Notes

- Spec coverage: this plan covers the first backend slice from the V1 spec: process abstraction, output normalization, pipe jobs, PTY smoke test, and initial developer entrypoint.
- Not covered yet: SQLite persistence, PySide6/QML HMI, Codex manual session, and multi-agent workflow. Those should be separate plans after the process layer is green.
- Type consistency: `BackendMode`, `StreamName`, `OutputEvent`, and `ProcessResult` are shared by both backends.
