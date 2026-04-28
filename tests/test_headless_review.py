from pathlib import Path

import pytest

from agenthub.adapters.headless import (
    build_headless_review_command,
    run_headless_review,
)
from agenthub.process.base import BackendMode, ProcessResult


def test_builds_claude_headless_review_command():
    assert build_headless_review_command("claude", "review this") == (
        "claude",
        "-p",
        "review this",
        "--output-format",
        "text",
    )


def test_builds_gemini_headless_review_command():
    assert build_headless_review_command("gemini", "review this") == (
        "gemini",
        "-p",
        "review this",
        "--output-format",
        "text",
        "--skip-trust",
        "--approval-mode",
        "plan",
    )


def test_rejects_unknown_headless_review_cli_type():
    with pytest.raises(ValueError, match="Unsupported headless review cli_type"):
        build_headless_review_command("codex", "review this")


class FakePipeBackend:
    def __init__(self) -> None:
        self.calls = []

    def run(self, run_id, command, cwd, timeout_seconds):
        self.calls.append(
            {
                "run_id": run_id,
                "command": command,
                "cwd": cwd,
                "timeout_seconds": timeout_seconds,
            }
        )
        return ProcessResult(
            run_id=run_id,
            backend_mode=BackendMode.PIPE,
            command=command,
            cwd=Path(cwd),
            exit_code=0,
            stdout="review ok",
            stderr="",
        )


def test_runs_headless_review_with_pipe_backend():
    backend = FakePipeBackend()

    result = run_headless_review(
        cli_type="claude",
        prompt="review this",
        cwd=Path("C:/work/project"),
        timeout_seconds=30,
        run_id="review-1",
        backend=backend,
    )

    assert result.stdout == "review ok"
    assert backend.calls == [
        {
            "run_id": "review-1",
            "command": (
                "claude",
                "-p",
                "review this",
                "--output-format",
                "text",
            ),
            "cwd": Path("C:/work/project"),
            "timeout_seconds": 30,
        }
    ]
