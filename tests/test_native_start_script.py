from __future__ import annotations

import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def ps_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def test_start_native_check_accepts_agents_alias() -> None:
    script_path = REPO_ROOT / "scripts" / "start-native.ps1"
    command = "\n".join(
        [
            "$ErrorActionPreference = 'Stop'",
            "function Get-Command {",
            "    $Name = $args[0]",
            "    if ($Name -in @('codex', 'claude', 'gemini')) {",
            "        [pscustomobject]@{ Source = \"mock:$Name\" }",
            "        return",
            "    }",
            "    Microsoft.PowerShell.Core\\Get-Command @args",
            "}",
            f"& {ps_quote(str(script_path))} -Check -Agent agents -Python {ps_quote(sys.executable)}",
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
    assert "Agent CLI check passed: codex" in result.stdout
    assert "Agent CLI check passed: claude" in result.stdout
    assert "Agent CLI check passed: gemini" in result.stdout
    assert "AgentHub Native launch check passed." in result.stdout


def test_start_native_check_uses_hook_dependency_python_probe(tmp_path: Path) -> None:
    script_path = REPO_ROOT / "scripts" / "start-native.ps1"
    fake_python = tmp_path / "fake-python.ps1"
    fake_python.write_text(
        "\n".join(
            [
                "$joined = $args -join ' '",
                "Write-Output $joined",
                "if ($joined -notlike '*import json, pathlib, sys, urllib.request; print(sys.executable)*') {",
                "    exit 19",
                "}",
                "exit 0",
            ]
        ),
        encoding="ascii",
    )

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
            f"& {ps_quote(str(script_path))} -Check -Agent codex -Python {ps_quote(str(fake_python))}",
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
    assert "import json, pathlib, sys, urllib.request; print(sys.executable)" in result.stdout
    assert "AgentHub Native launch check passed." in result.stdout
