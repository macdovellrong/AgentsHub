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
