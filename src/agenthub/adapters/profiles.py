from __future__ import annotations

from dataclasses import dataclass

from agenthub.process.base import Command


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
        command=(
            "powershell.exe",
            "-NoLogo",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "codex",
        ),
        placeholder="输入 Codex prompt",
    ),
)


def profile_by_id(profile_id: str) -> AgentProfile:
    for profile in DEFAULT_AGENT_PROFILES:
        if profile.id == profile_id:
            return profile
    raise KeyError(f"Unknown agent profile: {profile_id}")
