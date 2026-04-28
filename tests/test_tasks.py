import json

import pytest

from agenthub.storage.tasks import TaskStatus, TaskStore


def test_task_store_creates_workspace_task_record(tmp_path):
    workspace = tmp_path / "workspace"
    store = TaskStore.for_workspace(workspace)

    record = store.create_task(
        title="Add task board",
        description="Show pending and running tasks in the HMI.",
    )

    assert store.path == workspace / ".agenthub" / "tasks" / "tasks.jsonl"
    assert store.list_tasks() == (record,)
    assert record.id
    assert record.title == "Add task board"
    assert record.description == "Show pending and running tasks in the HMI."
    assert record.status == TaskStatus.PENDING
    assert record.run_id is None
    assert record.created_at
    assert record.updated_at == record.created_at

    line = store.path.read_text(encoding="utf-8").strip()
    data = json.loads(line)
    assert data["id"] == record.id
    assert data["title"] == "Add task board"
    assert data["status"] == "pending"


def test_task_store_loads_persisted_tasks(tmp_path):
    store = TaskStore.for_workspace(tmp_path / "workspace")
    first = store.create_task(title="First", description="")
    second = store.create_task(title="Second", description="next")

    reloaded = TaskStore(store.path)

    assert reloaded.list_tasks() == (first, second)


def test_task_store_updates_status(tmp_path):
    store = TaskStore.for_workspace(tmp_path / "workspace")
    record = store.create_task(title="Implement model", description="")

    updated = store.update_status(record.id, TaskStatus.RUNNING)

    assert updated.status == TaskStatus.RUNNING
    assert updated.updated_at >= record.updated_at
    assert store.list_tasks() == (updated,)


def test_task_store_accepts_status_value_strings(tmp_path):
    store = TaskStore.for_workspace(tmp_path / "workspace")
    record = store.create_task(title="Review code", description="")

    updated = store.update_status(record.id, "review")

    assert updated.status == TaskStatus.REVIEW


def test_task_store_attaches_run_id(tmp_path):
    store = TaskStore.for_workspace(tmp_path / "workspace")
    record = store.create_task(title="Run Codex", description="")

    updated = store.attach_run(record.id, "codex-20260428")

    assert updated.run_id == "codex-20260428"
    assert updated.status == TaskStatus.PENDING
    assert store.list_tasks() == (updated,)


def test_task_store_rejects_unknown_task_id(tmp_path):
    store = TaskStore.for_workspace(tmp_path / "workspace")

    with pytest.raises(KeyError, match="Unknown task_id"):
        store.update_status("missing", TaskStatus.RUNNING)

    with pytest.raises(KeyError, match="Unknown task_id"):
        store.attach_run("missing", "run-1")


def test_task_store_rejects_invalid_status(tmp_path):
    store = TaskStore.for_workspace(tmp_path / "workspace")
    record = store.create_task(title="Validate status", description="")

    with pytest.raises(ValueError, match="Invalid task status"):
        store.update_status(record.id, "blocked")


def test_task_store_rejects_blank_title(tmp_path):
    store = TaskStore.for_workspace(tmp_path / "workspace")

    with pytest.raises(ValueError, match="Task title cannot be blank"):
        store.create_task(title="   ", description="")
