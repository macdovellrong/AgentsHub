from agenthub.adapters.profiles import DEFAULT_AGENT_PROFILES, profile_by_id


def test_default_agent_profiles_include_powershell_and_codex():
    assert [profile.id for profile in DEFAULT_AGENT_PROFILES] == ["powershell", "codex"]
    assert profile_by_id("powershell").display_name == "PowerShell"
    assert profile_by_id("codex").display_name == "Codex"


def test_codex_profile_uses_powershell_launcher_for_unc_workspaces():
    profile = profile_by_id("codex")

    assert profile.command[:4] == (
        "powershell.exe",
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
    )
    assert profile.command[-1] == "codex"
