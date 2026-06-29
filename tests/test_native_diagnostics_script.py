from __future__ import annotations

import subprocess
import sys
from shutil import copyfile
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
    assert "- Execution mode: repository" in report
    assert "## Repository" in report
    assert "git status --short --branch" in report
    assert "## Windows" in report
    assert "Win32_OperatingSystem" in report
    assert "## Terminal Environment" in report
    assert "Get-AppxPackage -Name Microsoft.WindowsTerminal" in report
    assert "HKCU:\\Console" in report
    assert "## Input Devices" in report
    assert "Get-PnpDevice" in report
    assert "Win32_PointingDevice" in report
    assert "PrecisionTouchPad" in report
    assert "### Codex Native Launcher" in report
    assert "### Codex No Alt Screen Probe" in report
    assert "## Native Launch Checks" in report
    assert "start-native.ps1 -Check -Workspace" in report
    assert "## Hook Diagnostics" in report
    assert "hooks.jsonl" in report


def test_collect_native_diagnostics_supports_published_package_layout(tmp_path: Path) -> None:
    published_root = tmp_path / "published"
    scripts_dir = published_root / "scripts"
    hooks_dir = scripts_dir / "hooks"
    hooks_dir.mkdir(parents=True)
    copyfile(REPO_ROOT / "scripts" / "collect-native-diagnostics.ps1", scripts_dir / "collect-native-diagnostics.ps1")
    (published_root / "AgentHub.Native.App.exe").write_bytes(b"")
    (published_root / "start-agenthub-native.bat").write_text("@echo off\n", encoding="ascii")
    (published_root / "start-agenthub-native.ps1").write_text("Write-Output start\n", encoding="utf-8")
    (published_root / "collect-native-diagnostics.bat").write_text("@echo off\n", encoding="ascii")
    (published_root / "collect-native-diagnostics.ps1").write_text("Write-Output diagnostics\n", encoding="utf-8")
    for script_name in [
        "agenthub_hook_common.py",
        "agenthub_codex_stop.py",
        "agenthub_claude_stop.py",
        "agenthub_gemini_after_agent.py",
    ]:
        (hooks_dir / script_name).write_text("# hook\n", encoding="utf-8")
    output = tmp_path / "published-diagnostics.md"

    command = "\n".join(
        [
            "$ErrorActionPreference = 'Stop'",
            (
                f"& {ps_quote(str(scripts_dir / 'collect-native-diagnostics.ps1'))} "
                f"-Python {ps_quote(sys.executable)} "
                f"-Output {ps_quote(str(output))}"
            ),
            "exit $LASTEXITCODE",
        ]
    )

    result = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
        cwd=published_root,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    report = output.read_text(encoding="utf-8")
    assert "- Execution mode: published package" in report
    assert "## Published Package" in report
    assert "AgentHub.Native.App.exe" in report
    assert "start-agenthub-native.bat" in report
    assert "start-agenthub-native.ps1" in report
    assert "collect-native-diagnostics.bat" in report
    assert "collect-native-diagnostics.ps1" in report
    assert "scripts\\collect-native-diagnostics.ps1" in report
    assert "agenthub_hook_common.py" in report
    assert "### Codex Native Launcher" in report
    assert "### Codex No Alt Screen Probe" in report


def test_collect_native_diagnostics_resolves_relative_output_from_current_location(tmp_path: Path) -> None:
    script_path = REPO_ROOT / "scripts" / "collect-native-diagnostics.ps1"
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    output = cwd / "relative-diagnostics.md"

    command = "\n".join(
        [
            "$ErrorActionPreference = 'Stop'",
            f"Set-Location -LiteralPath {ps_quote(str(cwd))}",
            f"& {ps_quote(str(script_path))} -Python {ps_quote(sys.executable)} -Output 'relative-diagnostics.md'",
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
    assert output.exists()
    assert "# AgentHub Native Diagnostics" in output.read_text(encoding="utf-8")


def test_publish_native_script_includes_diagnostics_entrypoints() -> None:
    script = (REPO_ROOT / "scripts" / "publish-native.ps1").read_text(encoding="utf-8")

    assert "collect-native-diagnostics.ps1" in script
    assert "collect-native-diagnostics.bat" in script
