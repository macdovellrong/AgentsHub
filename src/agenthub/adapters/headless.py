from __future__ import annotations

from pathlib import Path

from agenthub.process.base import Command, ProcessResult
from agenthub.process.pipe_backend import PipeBackend


def build_headless_review_command(cli_type: str, prompt: str) -> Command:
    normalized_cli_type = cli_type.lower()
    if normalized_cli_type == "claude":
        return ("claude", "-p", prompt, "--output-format", "text")
    if normalized_cli_type == "gemini":
        return (
            "gemini",
            "-p",
            prompt,
            "--output-format",
            "text",
            "--skip-trust",
            "--approval-mode",
            "plan",
        )
    raise ValueError(f"Unsupported headless review cli_type: {cli_type}")


def run_headless_review(
    cli_type: str,
    prompt: str,
    cwd: Path | str | None,
    timeout_seconds: float = 300,
    run_id: str | None = None,
    backend: PipeBackend | None = None,
) -> ProcessResult:
    command = build_headless_review_command(cli_type, prompt)
    pipe_backend = backend or PipeBackend()
    return pipe_backend.run(
        run_id=run_id or f"{cli_type.lower()}-headless-review",
        command=command,
        cwd=cwd,
        timeout_seconds=timeout_seconds,
    )
