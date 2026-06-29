from __future__ import annotations

import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def ps_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def test_write_native_validation_report_generates_manual_checklist(tmp_path: Path) -> None:
    script_path = REPO_ROOT / "scripts" / "write-native-validation-report.ps1"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    output = tmp_path / "manual-validation.md"
    latest_diagnostics = tmp_path / "latest-diagnostics.txt"
    latest_laptop_validation = tmp_path / "latest-laptop-validation.txt"
    hook_log = tmp_path / "hooks.jsonl"

    command = "\n".join(
        [
            "$ErrorActionPreference = 'Stop'",
            (
                f"& {ps_quote(str(script_path))} "
                f"-Workspace {ps_quote(str(workspace))} "
                f"-LatestDiagnostics {ps_quote(str(latest_diagnostics))} "
                f"-LatestLaptopValidation {ps_quote(str(latest_laptop_validation))} "
                f"-HookLog {ps_quote(str(hook_log))} "
                f"-Session @('codex-1 | profile=codex', 'scrolltest-1 | profile=scrolltest') "
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
        timeout=60,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    report = output.read_text(encoding="utf-8-sig")
    assert "# AgentHub Native Manual Validation" in report
    assert f"Workspace: {workspace}" in report
    assert f"Latest diagnostics pointer: {latest_diagnostics}" in report
    assert f"Latest laptop validation pointer: {latest_laptop_validation}" in report
    assert f"Hook log: {hook_log}" in report
    assert "codex-1 | profile=codex" in report
    assert "scrolltest-1 | profile=scrolltest" in report
    assert "- [ ] Scroll Test shows a scrollbar." in report
    assert "- [ ] Codex resume shows scrollback and can scroll upward." in report
    assert "- [ ] Codex hook output appears in Collaboration timeline." in report
    assert "Manual validation report:" in result.stdout


def test_publish_native_script_includes_manual_validation_entrypoint() -> None:
    script = (REPO_ROOT / "scripts" / "publish-native.ps1").read_text(encoding="utf-8")

    assert "write-native-validation-report.ps1" in script
    assert "write-native-validation-report.bat" in script
    assert "Manual validation" in script
