from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def test_publish_native_script_generates_powershell_entrypoints() -> None:
    script = (REPO_ROOT / "scripts" / "publish-native.ps1").read_text(encoding="utf-8")

    assert "start-agenthub-native.ps1" in script
    assert "collect-native-diagnostics.ps1" in script
    assert "AgentHub.Native.App.exe" in script
    assert "AGENTHUB_HOOKS_SOURCE_DIR" in script
    assert "Push-Location -LiteralPath $packageRoot" in script
    assert "Pop-Location" in script
