from __future__ import annotations

import argparse
from pathlib import Path
import sys

from agenthub.orchestrator import orchestrate_requirement
from agenthub.process.pipe_backend import PipeBackend
from agenthub.storage.tasks import TaskStatus


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args == ["pipe-smoke"]:
        result = PipeBackend().run(
            run_id="pipe-smoke",
            command=[sys.executable, "-c", "print('AGENTHUB_PIPE_OK')"],
            cwd=None,
            timeout_seconds=10,
        )
        print(result.stdout, end="")
        return result.exit_code
    if args == ["hmi"]:
        from agenthub.ui.main_window import run_hmi

        return run_hmi(sys.argv)
    if args and args[0] == "orchestrate":
        parser = argparse.ArgumentParser(prog="python -m agenthub.main orchestrate")
        parser.add_argument("requirement")
        parser.add_argument("--workspace", required=True, type=Path)
        namespace = parser.parse_args(args[1:])
        result = orchestrate_requirement(
            namespace.requirement,
            workspace=namespace.workspace,
        )
        total = len(result.task_results)
        failed = sum(
            1
            for task_result in result.task_results
            if task_result.final_status == TaskStatus.FAILED
        )
        done = sum(
            1
            for task_result in result.task_results
            if task_result.final_status == TaskStatus.DONE
        )
        summary = (
            "orchestration "
            f"planned={total} done={done} failed={failed} "
            f"planning_exit={result.planning_result.exit_code}"
        )
        if result.planning_error:
            summary = f"{summary} planning_error={result.planning_error}"
        print(summary)
        return 1 if result.has_failures() else 0
    print("usage: python -m agenthub.main [pipe-smoke|hmi|orchestrate]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
