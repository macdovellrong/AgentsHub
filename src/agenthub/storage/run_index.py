from __future__ import annotations

import json
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from enum import StrEnum
from pathlib import Path
from typing import Any

from agenthub.storage.run_logs import RunLogPaths


class RunStatus(StrEnum):
    STARTING = "starting"
    RUNNING = "running"
    STOPPED = "stopped"
    EXITED = "exited"
    START_FAILED = "start_failed"


@dataclass(frozen=True)
class RunRecord:
    run_id: str
    profile_id: str
    profile_name: str
    workspace_path: Path
    started_at: str
    ended_at: str | None
    run_dir: Path
    raw_log_path: Path
    clean_log_path: Path
    status: RunStatus
    error_message: str | None = None


class RunIndexStore:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)

    @classmethod
    def for_workspace(cls, workspace_path: Path | str) -> RunIndexStore:
        workspace = Path(workspace_path)
        return cls(workspace / ".agenthub" / "runs" / "runs.jsonl")

    def create_run(
        self,
        *,
        profile_id: str,
        profile_name: str,
        workspace_path: Path | str,
        log_paths: RunLogPaths,
        status: RunStatus = RunStatus.STARTING,
        error_message: str | None = None,
    ) -> RunRecord:
        records = list(self.list_records())
        if any(record.run_id == log_paths.run_id for record in records):
            raise ValueError(f"Run already exists in index: {log_paths.run_id}")

        now = _now()
        record = RunRecord(
            run_id=log_paths.run_id,
            profile_id=profile_id,
            profile_name=profile_name,
            workspace_path=Path(workspace_path),
            started_at=now,
            ended_at=now if _is_terminal(status) else None,
            run_dir=log_paths.run_dir,
            raw_log_path=log_paths.raw_log_path,
            clean_log_path=log_paths.clean_log_path,
            status=status,
            error_message=error_message,
        )
        records.append(record)
        self._write_records(records)
        return record

    def update_status(
        self,
        run_id: str,
        status: RunStatus,
        *,
        error_message: str | None = None,
    ) -> RunRecord:
        records = list(self.list_records())
        for index, record in enumerate(records):
            if record.run_id == run_id:
                updated = replace(
                    record,
                    status=status,
                    ended_at=_now() if _is_terminal(status) else None,
                    error_message=error_message,
                )
                records[index] = updated
                self._write_records(records)
                return updated
        raise KeyError(f"Unknown run_id: {run_id}")

    def list_records(self) -> tuple[RunRecord, ...]:
        if not self.path.exists():
            return ()
        records: list[RunRecord] = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                records.append(_record_from_json(json.loads(line)))
        return tuple(records)

    def _write_records(self, records: list[RunRecord]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = "\n".join(
            json.dumps(_record_to_json(record), ensure_ascii=False, sort_keys=True)
            for record in records
        )
        if payload:
            payload += "\n"
        temp_path = self.path.with_name(f"{self.path.name}.tmp")
        temp_path.write_text(payload, encoding="utf-8")
        temp_path.replace(self.path)


def _record_to_json(record: RunRecord) -> dict[str, Any]:
    return {
        "run_id": record.run_id,
        "profile_id": record.profile_id,
        "profile_name": record.profile_name,
        "workspace_path": str(record.workspace_path),
        "started_at": record.started_at,
        "ended_at": record.ended_at,
        "run_dir": str(record.run_dir),
        "raw_log_path": str(record.raw_log_path),
        "clean_log_path": str(record.clean_log_path),
        "status": record.status.value,
        "error_message": record.error_message,
    }


def _record_from_json(data: Any) -> RunRecord:
    if not isinstance(data, dict):
        raise ValueError("Run index line must be a JSON object")
    return RunRecord(
        run_id=str(data["run_id"]),
        profile_id=str(data["profile_id"]),
        profile_name=str(data["profile_name"]),
        workspace_path=Path(str(data["workspace_path"])),
        started_at=str(data["started_at"]),
        ended_at=str(data["ended_at"]) if data.get("ended_at") is not None else None,
        run_dir=Path(str(data["run_dir"])),
        raw_log_path=Path(str(data["raw_log_path"])),
        clean_log_path=Path(str(data["clean_log_path"])),
        status=RunStatus(str(data["status"])),
        error_message=str(data["error_message"])
        if data.get("error_message") is not None
        else None,
    )


def _is_terminal(status: RunStatus) -> bool:
    return status in {
        RunStatus.STOPPED,
        RunStatus.EXITED,
        RunStatus.START_FAILED,
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
