from __future__ import annotations

import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def ps_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def test_validate_native_laptop_runs_checks_and_writes_diagnostics(tmp_path: Path) -> None:
    script_path = REPO_ROOT / "scripts" / "validate-native-laptop.ps1"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    output = tmp_path / "laptop-validation.md"

    command = "\n".join(
        [
            "$ErrorActionPreference = 'Stop'",
            "function Get-Command {",
            "    $Name = $args[0]",
            "    if ($Name -eq 'codex') {",
            "        [pscustomobject]@{ Source = \"mock:$Name\" }",
            "        return",
            "    }",
            "    Microsoft.PowerShell.Core\\Get-Command @args",
            "}",
            "function codex { '--no-alt-screen' }",
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
        timeout=180,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "Native laptop validation completed." in result.stdout
    assert "powershell codex preflight" in result.stdout
    assert "cmd codex preflight" in result.stdout
    assert "scrolltest preflight" in result.stdout
    assert "Diagnostics report:" in result.stdout
    assert output.exists()
    assert "# AgentHub Native Diagnostics" in output.read_text(encoding="utf-8")
    latest_pointer = output.parent / "latest-laptop-validation.txt"
    assert latest_pointer.exists()
    pointer_text = latest_pointer.read_text(encoding="utf-8")
    assert f"report: {output}" in pointer_text
    assert "status: passed" in pointer_text


def test_validate_native_laptop_still_writes_diagnostics_when_preflight_fails(tmp_path: Path) -> None:
    script_path = REPO_ROOT / "scripts" / "validate-native-laptop.ps1"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    output = tmp_path / "failed-laptop-validation.md"
    empty_path = tmp_path / "empty-path"
    empty_path.mkdir()

    command = "\n".join(
        [
            "$ErrorActionPreference = 'Stop'",
            f"$env:PATH = {ps_quote(str(empty_path))}",
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
        timeout=180,
        check=False,
    )

    assert result.returncode != 0
    assert output.exists()
    assert "# AgentHub Native Diagnostics" in output.read_text(encoding="utf-8")
    pointer_text = (output.parent / "latest-laptop-validation.txt").read_text(encoding="utf-8")
    assert f"report: {output}" in pointer_text
    assert "status: failed" in pointer_text


def test_validate_native_laptop_accepts_provider_qualified_output_path(tmp_path: Path) -> None:
    script_path = REPO_ROOT / "scripts" / "validate-native-laptop.ps1"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    output = tmp_path / "provider-qualified-validation.md"
    provider_output = f"Microsoft.PowerShell.Core\\FileSystem::{output}"

    command = "\n".join(
        [
            "$ErrorActionPreference = 'Stop'",
            "function Get-Command {",
            "    $Name = $args[0]",
            "    if ($Name -eq 'codex') {",
            "        [pscustomobject]@{ Source = \"mock:$Name\" }",
            "        return",
            "    }",
            "    Microsoft.PowerShell.Core\\Get-Command @args",
            "}",
            "function codex { '--no-alt-screen' }",
            (
                f"& {ps_quote(str(script_path))} "
                f"-Workspace {ps_quote(str(workspace))} "
                f"-Python {ps_quote(sys.executable)} "
                f"-Output {ps_quote(provider_output)}"
            ),
            "exit $LASTEXITCODE",
        ]
    )

    result = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert output.exists()
    pointer_text = (output.parent / "latest-laptop-validation.txt").read_text(encoding="utf-8")
    assert f"report: {output}" in pointer_text


def test_validate_native_laptop_supports_agent_selection() -> None:
    script = (REPO_ROOT / "scripts" / "validate-native-laptop.ps1").read_text(encoding="utf-8")

    assert '[string[]]$Agent = @("codex")' in script
    assert "-Agent $Agent" in script
    assert '$agentLabel = $Agent -join ","' in script
