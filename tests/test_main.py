from agenthub.main import main
from agenthub.process.base import BackendMode, ProcessResult


def _fake_orchestration_result(has_failures=False, planning_error=None):
    planning = ProcessResult(
        run_id="claude-plan",
        backend_mode=BackendMode.PIPE,
        command=("claude",),
        cwd=None,
        exit_code=0,
        stdout="{}",
    )

    class FakeResult:
        planning_result = planning
        task_results = ()

        def has_failures(self):
            return has_failures

    FakeResult.planning_error = planning_error
    return FakeResult()


def test_main_pipe_smoke_returns_zero():
    assert main(["pipe-smoke"]) == 0


def test_main_orchestrate_invokes_explicit_cli(monkeypatch, tmp_path, capsys):
    calls = []

    def fake_orchestrate_requirement(requirement, workspace):
        calls.append((requirement, workspace))
        return _fake_orchestration_result()

    monkeypatch.setattr(
        "agenthub.main.orchestrate_requirement",
        fake_orchestrate_requirement,
    )

    exit_code = main(["orchestrate", "Build it", "--workspace", str(tmp_path)])

    assert exit_code == 0
    assert calls == [("Build it", tmp_path)]
    assert "planned=0" in capsys.readouterr().out


def test_main_orchestrate_returns_nonzero_when_planning_has_no_tasks(
    monkeypatch,
    tmp_path,
    capsys,
):
    def fake_orchestrate_requirement(requirement, workspace):
        return _fake_orchestration_result(
            has_failures=True,
            planning_error="Claude did not return any parseable tasks",
        )

    monkeypatch.setattr(
        "agenthub.main.orchestrate_requirement",
        fake_orchestrate_requirement,
    )

    exit_code = main(["orchestrate", "Build it", "--workspace", str(tmp_path)])

    assert exit_code == 1
    assert "planning_error=Claude did not return any parseable tasks" in (
        capsys.readouterr().out
    )
