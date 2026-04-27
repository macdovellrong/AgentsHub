from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import TextIO

from agenthub.process.base import OutputEvent


@dataclass(frozen=True)
class RunLogPaths:
    run_id: str
    run_dir: Path
    raw_log_path: Path
    clean_log_path: Path


class RunLogWriter:
    def __init__(
        self,
        paths: RunLogPaths,
        raw_file: TextIO,
        clean_file: TextIO,
    ) -> None:
        self.paths = paths
        self._raw_file = raw_file
        self._clean_file = clean_file
        self._closed = False

    @classmethod
    def create(
        cls,
        root: Path | str,
        profile_id: str,
        run_id: str | None = None,
    ) -> RunLogWriter:
        root_path = Path(root)
        final_run_id = run_id or _new_run_id(profile_id)
        run_dir = root_path / final_run_id
        run_dir.mkdir(parents=True, exist_ok=False)
        paths = RunLogPaths(
            run_id=final_run_id,
            run_dir=run_dir,
            raw_log_path=run_dir / "raw.log",
            clean_log_path=run_dir / "clean.log",
        )
        return cls(
            paths=paths,
            raw_file=paths.raw_log_path.open("a", encoding="utf-8", newline=""),
            clean_file=paths.clean_log_path.open("a", encoding="utf-8", newline=""),
        )

    def append(self, event: OutputEvent) -> None:
        if self._closed:
            raise RuntimeError("RunLogWriter is closed")
        self._raw_file.write(event.raw)
        self._clean_file.write(event.clean)
        self._raw_file.flush()
        self._clean_file.flush()

    def close(self) -> None:
        if self._closed:
            return
        self._raw_file.close()
        self._clean_file.close()
        self._closed = True


def _new_run_id(profile_id: str) -> str:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    safe_profile_id = "".join(
        char if char.isalnum() or char in ("-", "_") else "-"
        for char in profile_id.lower()
    ).strip("-")
    return f"{safe_profile_id}-{timestamp}"
