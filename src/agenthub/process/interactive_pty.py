from __future__ import annotations

import queue
import threading
from pathlib import Path

from winpty import PtyProcess

from agenthub.process.base import Command, OutputEvent, StreamName
from agenthub.process.output import normalize_chunk


class InteractivePtySession:
    def __init__(
        self,
        run_id: str,
        command: Command,
        cwd: Path | str | None = None,
        cols: int = 120,
        rows: int = 40,
    ) -> None:
        self.run_id = run_id
        self.command = command
        self.cwd = Path(cwd) if cwd is not None else None
        self.cols = cols
        self.rows = rows
        self._process: PtyProcess | None = None
        self._events: queue.Queue[OutputEvent] = queue.Queue()
        self._reader: threading.Thread | None = None
        self._stop_requested = threading.Event()

    def start(self) -> None:
        if self._process is not None:
            raise RuntimeError("PTY session already started")
        self._process = PtyProcess.spawn(
            list(self.command),
            cwd=str(self.cwd) if self.cwd is not None else None,
            dimensions=(self.rows, self.cols),
        )
        self._reader = threading.Thread(
            target=self._read_loop,
            name=f"interactive-pty-reader-{self.run_id}",
            daemon=True,
        )
        self._reader.start()

    def write(self, text: str) -> None:
        process = self._require_process()
        if process.isalive():
            process.write(text)

    def drain(self) -> list[OutputEvent]:
        events: list[OutputEvent] = []
        while True:
            try:
                events.append(self._events.get_nowait())
            except queue.Empty:
                return events

    def is_alive(self) -> bool:
        return self._process is not None and self._process.isalive()

    def stop(self) -> None:
        process = self._process
        if process is None:
            return
        self._stop_requested.set()
        if process.isalive():
            process.terminate(force=True)
        if self._reader is not None:
            self._reader.join(timeout=1)

    def _read_loop(self) -> None:
        process = self._require_process()
        while not self._stop_requested.is_set():
            try:
                chunk = process.read(4096)
            except (EOFError, OSError):
                break
            if chunk:
                self._events.put(normalize_chunk(self.run_id, StreamName.PTY, chunk))
            elif not process.isalive():
                break

    def _require_process(self) -> PtyProcess:
        if self._process is None:
            raise RuntimeError("PTY session is not started")
        return self._process
