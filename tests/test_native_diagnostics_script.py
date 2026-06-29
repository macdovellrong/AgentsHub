from __future__ import annotations

import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def ps_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def test_collect_native_diagnostics_writes_markdown_report(tmp_path: Path) -> None:
    script_path = REPO_ROOT / "scripts" / "collect-native-diagnostics.ps1"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    output = tmp_path / "native-diagnostics.md"

    command = "\n".join(
        [
            "$ErrorActionPreference = 'Stop'",
            (
                f"& {ps_quote(str(script_path))} "
                f"-Workspace {ps_quote(str(workspace))} "
                f"-Python {ps_quote(sys.executable)} "
                f"-Output {ps_quote(str(output))}"
            ),
            "exit $LASTEXITCODE",
        ]
    )

    result = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    report = output.read_text(encoding="utf-8")
    assert "# AgentHub Native Diagnostics" in report
    assert "## Repository" in report
    assert "git status --short --branch" in report
    assert "## Native Launch Checks" in report
    assert "start-native.ps1 -Check -Workspace" in report
    assert "## Hook Diagnostics" in report
    assert "hooks.jsonl" in report
