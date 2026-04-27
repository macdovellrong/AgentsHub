from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Sequence


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
