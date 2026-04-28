from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class AppSettings:
    last_workspace: Path | None = None
    recent_workspaces: tuple[Path, ...] = ()


class SettingsStore:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)

    @classmethod
    def default(cls) -> SettingsStore:
        appdata = os.environ.get("APPDATA")
        root = Path(appdata) / "AgentHub" if appdata else Path.home() / ".agenthub"
        return cls(root / "settings.json")

    def load(self) -> AppSettings:
        if not self.path.exists():
            return AppSettings()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return AppSettings()
        return _settings_from_json(data)

    def save(self, settings: AppSettings) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "last_workspace": str(settings.last_workspace)
            if settings.last_workspace is not None
            else None,
            "recent_workspaces": [str(path) for path in settings.recent_workspaces],
        }
        self.path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def record_workspace(self, workspace: Path | str, max_recent: int = 8) -> None:
        workspace_path = Path(workspace)
        existing = self.load().recent_workspaces
        recent = [workspace_path]
        workspace_key = _path_key(workspace_path)
        for path in existing:
            if _path_key(path) != workspace_key:
                recent.append(path)
        self.save(
            AppSettings(
                last_workspace=workspace_path,
                recent_workspaces=tuple(recent[:max_recent]),
            )
        )


def _settings_from_json(data: Any) -> AppSettings:
    if not isinstance(data, dict):
        return AppSettings()
    last_workspace = data.get("last_workspace")
    recent_workspaces = data.get("recent_workspaces", [])
    return AppSettings(
        last_workspace=Path(last_workspace) if isinstance(last_workspace, str) else None,
        recent_workspaces=tuple(
            Path(path) for path in recent_workspaces if isinstance(path, str)
        ),
    )


def _path_key(path: Path) -> str:
    return str(path).casefold()
