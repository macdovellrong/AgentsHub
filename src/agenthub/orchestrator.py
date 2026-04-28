from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from agenthub.adapters.headless import run_headless_review
from agenthub.process.base import Command, ProcessResult
from agenthub.process.pipe_backend import PipeBackend
from agenthub.storage.tasks import TaskRecord, TaskStatus, TaskStore


@dataclass(frozen=True)
class TaskSpec:
    title: str
    description: str = ""


@dataclass(frozen=True)
class OrchestratedTaskResult:
    task: TaskRecord
    codex_result: ProcessResult
    review_result: ProcessResult | None
    final_status: TaskStatus


@dataclass(frozen=True)
class OrchestrationResult:
    planning_result: ProcessResult
    task_results: tuple[OrchestratedTaskResult, ...]
    planning_error: str | None = None

    def has_failures(self) -> bool:
        if self.planning_result.exit_code != 0:
            return True
        if self.planning_error is not None:
            return True
        return any(
            result.final_status == TaskStatus.FAILED
            for result in self.task_results
        )


HeadlessRunner = Callable[..., ProcessResult]
CodexRunner = Callable[..., ProcessResult]


def parse_task_plan(text: str) -> tuple[TaskSpec, ...]:
    stripped = text.strip()
    if not stripped:
        return ()

    json_payload = _load_json_payload(stripped)
    if json_payload is not None:
        return tuple(_task_specs_from_payload(json_payload))

    return tuple(_task_specs_from_markdown(stripped))


def build_codex_exec_command(workspace: Path | str, prompt: str) -> Command:
    return (
        "codex",
        "exec",
        "--cd",
        str(Path(workspace)),
        "--sandbox",
        "workspace-write",
        "--color",
        "never",
        prompt,
    )


def run_codex_exec(
    prompt: str,
    cwd: Path | str | None,
    timeout_seconds: float = 900,
    run_id: str | None = None,
    backend: PipeBackend | None = None,
) -> ProcessResult:
    workspace = Path(cwd) if cwd is not None else Path.cwd()
    command = build_codex_exec_command(workspace, prompt)
    pipe_backend = backend or PipeBackend()
    return pipe_backend.run(
        run_id=run_id or "codex-exec",
        command=command,
        cwd=workspace,
        timeout_seconds=timeout_seconds,
    )


def orchestrate_requirement(
    requirement: str,
    workspace: Path | str,
    task_store: TaskStore | None = None,
    headless_runner: HeadlessRunner = run_headless_review,
    codex_runner: CodexRunner = run_codex_exec,
    plan_timeout_seconds: float = 300,
    codex_timeout_seconds: float = 900,
    review_timeout_seconds: float = 300,
) -> OrchestrationResult:
    workspace_path = Path(workspace)
    store = task_store or TaskStore.for_workspace(workspace_path)

    planning_result = headless_runner(
        "claude",
        _build_claude_planning_prompt(requirement),
        workspace_path,
        timeout_seconds=plan_timeout_seconds,
        run_id="claude-orchestrate-plan",
    )
    if planning_result.exit_code != 0:
        return OrchestrationResult(planning_result=planning_result, task_results=())

    task_specs = parse_task_plan(planning_result.stdout)
    if not task_specs:
        return OrchestrationResult(
            planning_result=planning_result,
            task_results=(),
            planning_error="Claude did not return any parseable tasks",
        )

    task_results: list[OrchestratedTaskResult] = []
    for spec in task_specs:
        task = store.create_task(title=spec.title, description=spec.description)
        store.update_status(task.id, TaskStatus.RUNNING)

        codex_result = codex_runner(
            _build_codex_task_prompt(requirement, spec),
            workspace_path,
            timeout_seconds=codex_timeout_seconds,
            run_id=f"codex-{task.id}",
        )
        task = store.attach_run(task.id, codex_result.run_id)
        if codex_result.exit_code != 0:
            task = store.update_status(task.id, TaskStatus.FAILED)
            task_results.append(
                OrchestratedTaskResult(
                    task=task,
                    codex_result=codex_result,
                    review_result=None,
                    final_status=TaskStatus.FAILED,
                )
            )
            continue

        task = store.update_status(task.id, TaskStatus.REVIEW)
        review_result = headless_runner(
            "gemini",
            _build_gemini_review_prompt(requirement, spec, codex_result),
            workspace_path,
            timeout_seconds=review_timeout_seconds,
            run_id=f"gemini-review-{task.id}",
        )
        final_status = (
            TaskStatus.DONE
            if review_result.exit_code == 0
            else TaskStatus.FAILED
        )
        task = store.update_status(task.id, final_status)
        task_results.append(
            OrchestratedTaskResult(
                task=task,
                codex_result=codex_result,
                review_result=review_result,
                final_status=final_status,
            )
        )

    return OrchestrationResult(
        planning_result=planning_result,
        task_results=tuple(task_results),
    )


def _load_json_payload(text: str) -> Any | None:
    candidates = [text]
    fenced = re.search(
        r"```(?:json)?\s*(.*?)```",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )
    if fenced:
        candidates.insert(0, fenced.group(1).strip())

    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    return None


def _task_specs_from_payload(payload: Any) -> list[TaskSpec]:
    if isinstance(payload, dict):
        payload = payload.get("tasks", [])
    if not isinstance(payload, list):
        return []

    specs = []
    for item in payload:
        spec = _task_spec_from_item(item)
        if spec is not None:
            specs.append(spec)
    return specs


def _task_spec_from_item(item: Any) -> TaskSpec | None:
    if isinstance(item, str):
        title = item.strip()
        return TaskSpec(title=title) if title else None
    if not isinstance(item, dict):
        return None

    title = str(item.get("title") or item.get("name") or "").strip()
    if not title:
        return None
    description = str(item.get("description") or item.get("details") or "").strip()
    return TaskSpec(title=title, description=description)


def _task_specs_from_markdown(text: str) -> list[TaskSpec]:
    specs = []
    item_pattern = re.compile(
        r"^\s*(?:[-*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+?)\s*$"
    )
    for line in text.splitlines():
        match = item_pattern.match(line)
        if not match:
            continue
        title, description = _split_markdown_task(match.group(1).strip())
        if title:
            specs.append(TaskSpec(title=title, description=description))
    return specs


def _split_markdown_task(text: str) -> tuple[str, str]:
    for separator in (" - ", ": "):
        if separator in text:
            title, description = text.split(separator, 1)
            return title.strip(), description.strip()
    return text.strip(), ""


def _build_claude_planning_prompt(requirement: str) -> str:
    return (
        "Break the user requirement into small implementation tasks for AgentHub. "
        "Return only JSON in this shape: "
        '{"tasks":[{"title":"short title","description":"specific scope"}]}. '
        f"Requirement:\n{requirement}"
    )


def _build_codex_task_prompt(requirement: str, task: TaskSpec) -> str:
    return (
        "Implement this AgentHub subtask in the current workspace. "
        "Do not commit changes. Use the repository tests where relevant.\n\n"
        f"Original requirement:\n{requirement}\n\n"
        f"Subtask title: {task.title}\n"
        f"Subtask description: {task.description}"
    )


def _build_gemini_review_prompt(
    requirement: str,
    task: TaskSpec,
    codex_result: ProcessResult,
) -> str:
    return (
        "Review the Codex execution for this AgentHub subtask. "
        "Report whether the implementation satisfies the task and identify issues.\n\n"
        f"Original requirement:\n{requirement}\n\n"
        f"Subtask title: {task.title}\n"
        f"Subtask description: {task.description}\n\n"
        f"Codex exit code: {codex_result.exit_code}\n"
        f"Codex stdout:\n{codex_result.stdout}\n\n"
        f"Codex stderr:\n{codex_result.stderr}"
    )
