from pathlib import Path

from agenthub.storage.settings import AppSettings, SettingsStore


def test_settings_store_loads_empty_settings_when_file_is_missing(tmp_path):
    store = SettingsStore(tmp_path / "settings.json")

    assert store.load() == AppSettings()


def test_settings_store_records_last_workspace_and_recent_list(tmp_path):
    store = SettingsStore(tmp_path / "settings.json")
    first = tmp_path / "first"
    second = tmp_path / "second"

    store.record_workspace(first)
    store.record_workspace(second)

    settings = store.load()
    assert settings.last_workspace == second
    assert settings.recent_workspaces == (second, first)


def test_settings_store_moves_duplicate_workspace_to_front(tmp_path):
    store = SettingsStore(tmp_path / "settings.json")
    first = tmp_path / "first"
    second = tmp_path / "second"

    store.record_workspace(first)
    store.record_workspace(second)
    store.record_workspace(first)

    assert store.load().recent_workspaces == (first, second)


def test_settings_store_caps_recent_workspaces(tmp_path):
    store = SettingsStore(tmp_path / "settings.json")
    for index in range(10):
        store.record_workspace(Path(tmp_path / f"project-{index}"), max_recent=3)

    assert store.load().recent_workspaces == (
        tmp_path / "project-9",
        tmp_path / "project-8",
        tmp_path / "project-7",
    )
