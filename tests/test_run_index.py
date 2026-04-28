import json

from agenthub.storage.run_index import RunIndexStore, RunStatus
from agenthub.storage.run_logs import RunLogPaths


def test_run_index_store_creates_workspace_jsonl_record(tmp_path):
    workspace = tmp_path / "workspace"
    run_root = workspace / ".agenthub" / "runs"
    paths = RunLogPaths(
        run_id="powershell-1",
        run_dir=run_root / "powershell-1",
        raw_log_path=run_root / "powershell-1" / "raw.log",
        clean_log_path=run_root / "powershell-1" / "clean.log",
    )

    store = RunIndexStore.for_workspace(workspace)
    record = store.create_run(
        profile_id="powershell",
        profile_name="PowerShell",
        workspace_path=workspace,
        log_paths=paths,
        status=RunStatus.RUNNING,
    )

    assert store.path == run_root / "runs.jsonl"
    assert store.list_records() == (record,)
    assert record.run_id == "powershell-1"
    assert record.profile_id == "powershell"
    assert record.profile_name == "PowerShell"
    assert record.workspace_path == workspace
    assert record.run_dir == paths.run_dir
    assert record.raw_log_path == paths.raw_log_path
    assert record.clean_log_path == paths.clean_log_path
    assert record.status == RunStatus.RUNNING
    assert record.ended_at is None

    line = store.path.read_text(encoding="utf-8").strip()
    data = json.loads(line)
    assert data["run_id"] == "powershell-1"
    assert data["workspace_path"] == str(workspace)
    assert data["raw_log_path"] == str(paths.raw_log_path)


def test_run_index_store_updates_existing_record_status(tmp_path):
    workspace = tmp_path / "workspace"
    run_root = workspace / ".agenthub" / "runs"
    paths = RunLogPaths(
        run_id="codex-1",
        run_dir=run_root / "codex-1",
        raw_log_path=run_root / "codex-1" / "raw.log",
        clean_log_path=run_root / "codex-1" / "clean.log",
    )
    store = RunIndexStore.for_workspace(workspace)
    store.create_run(
        profile_id="codex",
        profile_name="Codex",
        workspace_path=workspace,
        log_paths=paths,
        status=RunStatus.RUNNING,
    )

    updated = store.update_status("codex-1", RunStatus.STOPPED)

    records = store.list_records()
    assert records == (updated,)
    assert updated.status == RunStatus.STOPPED
    assert updated.ended_at is not None
    assert len(store.path.read_text(encoding="utf-8").splitlines()) == 1
