from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def test_publish_native_script_generates_powershell_entrypoints() -> None:
    script = (REPO_ROOT / "scripts" / "publish-native.ps1").read_text(encoding="utf-8")

    assert "start-agenthub-native.ps1" in script
    assert "collect-native-diagnostics.ps1" in script
    assert "validate-native-laptop.ps1" in script
    assert "AgentHub.Native.App.exe" in script
    assert "AGENTHUB_HOOKS_SOURCE_DIR" in script
    assert "Push-Location -LiteralPath $packageRoot" in script
    assert "Pop-Location" in script


def test_publish_native_script_embeds_laptop_validation_pointer() -> None:
    script = (REPO_ROOT / "scripts" / "publish-native.ps1").read_text(encoding="utf-8")

    assert "latest-laptop-validation.txt" in script
    assert "status: $Status" in script
    assert '"passed"' in script
    assert '"failed"' in script
    assert "report:" in script


def test_publish_native_script_embeds_hook_python_validation() -> None:
    script = (REPO_ROOT / "scripts" / "publish-native.ps1").read_text(encoding="utf-8")

    assert 'Invoke-ValidationStep "hook python"' in script
    assert "Split-HookPythonCommand" in script
    assert "urllib.request" in script
    assert "Hook Python command failed" in script


def test_publish_native_script_embeds_workspace_path_validation() -> None:
    script = (REPO_ROOT / "scripts" / "publish-native.ps1").read_text(encoding="utf-8")

    assert 'Invoke-ValidationStep "workspace path"' in script
    assert "Test-WorkspacePath" in script
    assert "Workspace path was not found or is not a directory" in script


def test_publish_native_script_embeds_agent_selection_validation() -> None:
    script = (REPO_ROOT / "scripts" / "publish-native.ps1").read_text(encoding="utf-8")

    assert '[string[]]$Agent = @("codex")' in script
    assert '$normalized -eq "agents"' in script
    assert '$parsedAgents += @("codex", "claude", "gemini")' in script
    assert '"claude" { return "claude" }' in script
    assert '"gemini" { return "gemini" }' in script
    assert 'Invoke-ValidationStep "agent native launchers"' in script
    assert "& $diagnosticsScript -Workspace $Workspace -Agent $Agent -Python $Python -Output $resolvedOutput" in script
