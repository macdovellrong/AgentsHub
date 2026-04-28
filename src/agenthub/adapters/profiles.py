from __future__ import annotations

from dataclasses import dataclass

from agenthub.process.base import Command


def _powershell_launcher(command_name: str) -> Command:
    return (
        "powershell.exe",
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command_name,
    )


@dataclass(frozen=True)
class AgentProfile:
    id: str
    display_name: str
    command: Command
    placeholder: str


DEFAULT_AGENT_PROFILES: tuple[AgentProfile, ...] = (
    AgentProfile(
        id="powershell",
        display_name="PowerShell",
        command=("powershell.exe", "-NoLogo", "-NoProfile"),
        placeholder="输入 PowerShell 命令",
    ),
    AgentProfile(
        id="codex",
        display_name="Codex",
        command=_powershell_launcher("codex"),
        placeholder="输入 Codex prompt",
    ),
    AgentProfile(
        id="claude",
        display_name="Claude",
        command=_powershell_launcher("claude"),
        placeholder="输入 Claude prompt",
    ),
    AgentProfile(
        id="gemini",
        display_name="Gemini",
        command=_powershell_launcher("gemini"),
        placeholder="输入 Gemini prompt",
    ),
)


def profile_by_id(profile_id: str) -> AgentProfile:
    for profile in DEFAULT_AGENT_PROFILES:
        if profile.id == profile_id:
            return profile
    raise KeyError(f"Unknown agent profile: {profile_id}")
