# AgentHub Recent Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remember the last selected workspace and expose recent workspaces in the HMI.

**Architecture:** Store user-level app settings in a small JSON file. `SettingsStore` owns persistence; `MainWindow` receives an optional store, restores the last workspace on startup, records workspace changes, and populates a recent-workspace combo box.

**Tech Stack:** Python 3.11+, JSON, PySide6 Qt Widgets, pytest.

---

## File Structure

- `src/agenthub/storage/settings.py`: app settings dataclass and JSON-backed store.
- `src/agenthub/ui/main_window.py`: restore last workspace, save workspace changes, and show recent workspace selector.
- `tests/test_settings.py`: settings store unit tests.
- `tests/test_main_window.py`: HMI settings integration tests.
- `README.md`: document `%APPDATA%\AgentHub\settings.json`.

## Task 1: Settings Store

- [x] **Step 1: Write failing settings tests**

Verify missing settings load as empty, workspace changes persist, duplicate workspace entries move to the front, and recent entries are capped.

- [x] **Step 2: Run tests to verify RED**

Run: `python -m pytest tests/test_settings.py -v`

Expected: FAIL because `agenthub.storage.settings` does not exist.

- [x] **Step 3: Implement settings store**

Create `AppSettings`, `SettingsStore.default()`, `load()`, `save()`, and `record_workspace()`.

- [x] **Step 4: Run tests to verify GREEN**

Run: `python -m pytest tests/test_settings.py -v`

Expected: PASS.

## Task 2: HMI Integration

- [x] **Step 1: Write failing HMI tests**

Verify HMI restores the last workspace, persists `set_workspace()` calls, and lists recent workspaces.

- [x] **Step 2: Run tests to verify RED**

Run: `python -m pytest tests/test_main_window.py -v`

Expected: FAIL because `settings_store` and `recent_workspace_combo` do not exist.

- [x] **Step 3: Implement HMI settings wiring**

Accept `settings_store`, restore last workspace during init, update settings from `set_workspace()`, and populate `recent_workspace_combo`.

- [x] **Step 4: Run tests to verify GREEN**

Run: `python -m pytest tests/test_main_window.py -v`

Expected: PASS.

## Self-Review Notes

- Settings are user-level, not workspace-level, because the app needs to know the last workspace before one is selected.
- Recent workspace persistence does not add SQLite. JSON is sufficient for this small user preference.
