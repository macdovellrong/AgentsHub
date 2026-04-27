from __future__ import annotations

import queue
import threading
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
            cwd=str(cwd) if cwd is not None else None,
            dimensions=(self.rows, self.cols),
        )
        chunks: queue.Queue[str] = queue.Queue()

        def read_loop() -> None:
            while True:
                try:
                    chunk = process.read(4096)
                except (EOFError, OSError):
                    break
                if chunk:
                    chunks.put(chunk)
                elif not process.isalive():
                    break

        reader = threading.Thread(target=read_loop, name=f"pty-reader-{run_id}", daemon=True)
        reader.start()

        process.write(input_text)
        output: list[str] = []
        deadline = time.monotonic() + timeout_seconds

        while time.monotonic() < deadline:
            try:
                output.append(chunks.get(timeout=0.05))
            except queue.Empty:
                if not process.isalive() and chunks.empty():
                    break

        if process.isalive():
            process.terminate(force=True)

        reader.join(timeout=1)
        text = "".join(output)
        exit_code = process.exitstatus if process.exitstatus is not None else 0
        events = [normalize_chunk(run_id, StreamName.PTY, text)] if text else []
        return ProcessResult(
            run_id=run_id,
            backend_mode=BackendMode.PTY,
            command=command,
            cwd=Path(cwd) if cwd is not None else None,
            exit_code=exit_code,
            stdout=text,
            events=events,
        )
