from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from enum import StrEnum
from pathlib import Path
from typing import Any


class TaskStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    REVIEW = "review"
    DONE = "done"
    FAILED = "failed"


@dataclass(frozen=True)
class TaskRecord:
    id: str
    title: str
    description: str
    status: TaskStatus
    run_id: str | None
    created_at: str
    updated_at: str


class TaskStore:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)

    @classmethod
    def for_workspace(cls, workspace_path: Path | str) -> TaskStore:
        workspace = Path(workspace_path)
        return cls(workspace / ".agenthub" / "tasks" / "tasks.jsonl")

    def create_task(self, *, title: str, description: str) -> TaskRecord:
        normalized_title = title.strip()
        if not normalized_title:
            raise ValueError("Task title cannot be blank")

        records = list(self.list_tasks())
        now = _now()
        record = TaskRecord(
            id=uuid.uuid4().hex,
            title=normalized_title,
            description=description,
            status=TaskStatus.PENDING,
            run_id=None,
            created_at=now,
            updated_at=now,
        )
        records.append(record)
        self._write_records(records)
        return record

    def list_tasks(self) -> tuple[TaskRecord, ...]:
        if not self.path.exists():
            return ()
        records: list[TaskRecord] = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                records.append(_record_from_json(json.loads(line)))
        return tuple(records)

    def update_status(
        self,
        task_id: str,
        status: TaskStatus | str,
    ) -> TaskRecord:
        task_status = _coerce_status(status)
        return self._update_task(
            task_id,
            lambda record: replace(
                record,
                status=task_status,
                updated_at=_now(),
            ),
        )

    def attach_run(self, task_id: str, run_id: str) -> TaskRecord:
        return self._update_task(
            task_id,
            lambda record: replace(
                record,
                run_id=run_id,
                updated_at=_now(),
            ),
        )

    def _update_task(
        self,
        task_id: str,
        update: Callable[[TaskRecord], TaskRecord],
    ) -> TaskRecord:
        records = list(self.list_tasks())
        for index, record in enumerate(records):
            if record.id == task_id:
                updated = update(record)
                records[index] = updated
                self._write_records(records)
                return updated
        raise KeyError(f"Unknown task_id: {task_id}")

    def _write_records(self, records: list[TaskRecord]) -> None:
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


def _record_to_json(record: TaskRecord) -> dict[str, Any]:
    return {
        "id": record.id,
        "title": record.title,
        "description": record.description,
        "status": record.status.value,
        "run_id": record.run_id,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def _record_from_json(data: Any) -> TaskRecord:
    if not isinstance(data, dict):
        raise ValueError("Task line must be a JSON object")
    return TaskRecord(
        id=str(data["id"]),
        title=str(data["title"]),
        description=str(data.get("description", "")),
        status=_coerce_status(data["status"]),
        run_id=str(data["run_id"]) if data.get("run_id") is not None else None,
        created_at=str(data["created_at"]),
        updated_at=str(data["updated_at"]),
    )


def _coerce_status(status: TaskStatus | str) -> TaskStatus:
    if isinstance(status, TaskStatus):
        return status
    try:
        return TaskStatus(str(status))
    except ValueError as exc:
        raise ValueError(f"Invalid task status: {status}") from exc


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
