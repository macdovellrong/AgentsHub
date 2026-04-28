from pathlib import Path

from agenthub.orchestrator import (
    build_codex_exec_command,
    orchestrate_requirement,
    parse_task_plan,
)
from agenthub.process.base import BackendMode, ProcessResult
from agenthub.storage.tasks import TaskStatus, TaskStore


def _result(run_id, command=("fake",), exit_code=0, stdout="", stderr=""):
    return ProcessResult(
        run_id=run_id,
        backend_mode=BackendMode.PIPE,
        command=command,
        cwd=Path("C:/work/project"),
        exit_code=exit_code,
        stdout=stdout,
        stderr=stderr,
    )


def test_parse_task_plan_accepts_json_object_tasks():
    tasks = parse_task_plan(
        """
        {
          "tasks": [
            {"title": "Add model", "description": "Create dataclasses"},
            {"title": "Add CLI", "description": "Wire explicit command"}
          ]
        }
        """
    )

    assert [task.title for task in tasks] == ["Add model", "Add CLI"]
    assert tasks[0].description == "Create dataclasses"


def test_parse_task_plan_accepts_json_list_and_markdown_fallback():
    json_tasks = parse_task_plan('["Add tests", "Implement runner"]')
    markdown_tasks = parse_task_plan(
        """
        1. Add tests - cover fake orchestration
        2. Implement runner: call Codex with workspace sandbox
        - Update docs
        """
    )

    assert [task.title for task in json_tasks] == ["Add tests", "Implement runner"]
    assert [task.title for task in markdown_tasks] == [
        "Add tests",
        "Implement runner",
        "Update docs",
    ]
    assert markdown_tasks[0].description == "cover fake orchestration"
    assert markdown_tasks[1].description == "call Codex with workspace sandbox"


def test_build_codex_exec_command_uses_workspace_write_sandbox():
    assert build_codex_exec_command(Path("C:/work/project"), "do the task") == (
        "codex",
        "exec",
        "--cd",
        "C:\\work\\project",
        "--sandbox",
        "workspace-write",
        "--color",
        "never",
        "do the task",
    )


def test_orchestrate_requirement_creates_tasks_and_marks_done(tmp_path):
    workspace = tmp_path / "workspace"
    store = TaskStore.for_workspace(workspace)
    calls = []

    def fake_headless(cli_type, prompt, cwd, timeout_seconds=300, run_id=None, backend=None):
        calls.append((cli_type, prompt, cwd, run_id))
        if cli_type == "claude":
            return _result(
                run_id,
                stdout='{"tasks":[{"title":"Add parser","description":"Parse Claude output"}]}',
            )
        return _result(run_id, stdout="review passed")

    def fake_codex(prompt, cwd, timeout_seconds=900, run_id=None, backend=None):
        calls.append(("codex", prompt, cwd, run_id))
        return _result(run_id, stdout="implemented")

    result = orchestrate_requirement(
        "Build orchestration",
        workspace=workspace,
        task_store=store,
        headless_runner=fake_headless,
        codex_runner=fake_codex,
    )

    records = store.list_tasks()
    assert len(records) == 1
    assert records[0].title == "Add parser"
    assert records[0].status == TaskStatus.DONE
    assert records[0].run_id == result.task_results[0].codex_result.run_id
    assert result.planning_result.stdout
    assert result.task_results[0].codex_result.stdout == "implemented"
    assert result.task_results[0].review_result.stdout == "review passed"
    assert [call[0] for call in calls] == ["claude", "codex", "gemini"]


def test_orchestrate_requirement_fails_when_claude_returns_no_tasks(tmp_path):
    workspace = tmp_path / "workspace"
    store = TaskStore.for_workspace(workspace)

    def fake_headless(cli_type, prompt, cwd, timeout_seconds=300, run_id=None, backend=None):
        return _result(run_id, stdout="Claude could not split this.")

    def fake_codex(prompt, cwd, timeout_seconds=900, run_id=None, backend=None):
        raise AssertionError("Codex should not run without parsed tasks")

    result = orchestrate_requirement(
        "Build orchestration",
        workspace=workspace,
        task_store=store,
        headless_runner=fake_headless,
        codex_runner=fake_codex,
    )

    assert result.task_results == ()
    assert store.list_tasks() == ()
    assert result.planning_error == "Claude did not return any parseable tasks"
    assert result.has_failures() is True


def test_orchestrate_requirement_fails_when_claude_stdout_is_empty(tmp_path):
    workspace = tmp_path / "workspace"
    store = TaskStore.for_workspace(workspace)

    def fake_headless(cli_type, prompt, cwd, timeout_seconds=300, run_id=None, backend=None):
        return _result(run_id, stdout="")

    result = orchestrate_requirement(
        "Build orchestration",
        workspace=workspace,
        task_store=store,
        headless_runner=fake_headless,
    )

    assert result.task_results == ()
    assert result.planning_error == "Claude did not return any parseable tasks"
    assert result.has_failures() is True


def test_orchestrate_requirement_marks_task_failed_when_codex_fails(tmp_path):
    workspace = tmp_path / "workspace"
    store = TaskStore.for_workspace(workspace)

    def fake_headless(cli_type, prompt, cwd, timeout_seconds=300, run_id=None, backend=None):
        return _result(run_id, stdout='{"tasks":[{"title":"Break build"}]}')

    def fake_codex(prompt, cwd, timeout_seconds=900, run_id=None, backend=None):
        return _result(run_id, exit_code=1, stderr="codex failed")

    result = orchestrate_requirement(
        "Build orchestration",
        workspace=workspace,
        task_store=store,
        headless_runner=fake_headless,
        codex_runner=fake_codex,
    )

    assert store.list_tasks()[0].status == TaskStatus.FAILED
    assert result.task_results[0].codex_result.exit_code == 1
    assert result.task_results[0].review_result is None


def test_orchestrate_requirement_marks_task_failed_when_gemini_review_fails(tmp_path):
    workspace = tmp_path / "workspace"
    store = TaskStore.for_workspace(workspace)

    def fake_headless(cli_type, prompt, cwd, timeout_seconds=300, run_id=None, backend=None):
        if cli_type == "claude":
            return _result(run_id, stdout='{"tasks":[{"title":"Review me"}]}')
        return _result(run_id, exit_code=1, stderr="review failed")

    def fake_codex(prompt, cwd, timeout_seconds=900, run_id=None, backend=None):
        return _result(run_id, stdout="implemented")

    result = orchestrate_requirement(
        "Build orchestration",
        workspace=workspace,
        task_store=store,
        headless_runner=fake_headless,
        codex_runner=fake_codex,
    )

    assert store.list_tasks()[0].status == TaskStatus.FAILED
    assert result.task_results[0].codex_result.exit_code == 0
    assert result.task_results[0].review_result.exit_code == 1
