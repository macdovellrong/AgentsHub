# AgentHub Workspace Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the HMI choose which project folder a PowerShell or Codex PTY session manages.

**Architecture:** `MainWindow` owns a workspace path that defaults to the process current working directory. The workspace path drives both `InteractivePtySession.cwd` and the default run log root, so agent processes and logs stay anchored to the selected project.

**Tech Stack:** Python 3.11+, PySide6 Qt Widgets, pytest.

---

## File Structure

- `src/agenthub/ui/main_window.py`: workspace label, directory chooser, workspace state, and session cwd wiring.
- `tests/test_main_window.py`: workspace default, workspace switching, and session cwd tests.
- `README.md`: document workspace-driven behavior.

## Task 1: Workspace State Tests

- [x] **Step 1: Write failing tests**

Verify `MainWindow(workspace_path=...)` sets `workspace_path`, derives `log_root`, and shows the path in the UI.

- [x] **Step 2: Run tests to verify RED**

Run: `python -m pytest tests/test_main_window.py -v`

Expected: FAIL because `workspace_path` is not accepted.

- [x] **Step 3: Implement workspace state**

Add `workspace_path`, `log_root`, `set_workspace()`, and UI label/button wiring.

- [x] **Step 4: Run tests to verify GREEN**

Run: `python -m pytest tests/test_main_window.py -v`

Expected: PASS.

## Task 2: Session CWD Wiring

- [x] **Step 1: Write failing test**

Verify `_create_session()` creates `InteractivePtySession` with `cwd` equal to the selected workspace.

- [x] **Step 2: Run tests to verify RED**

Run: `python -m pytest tests/test_main_window.py -v`

Expected: FAIL because `_create_session()` does not exist.

- [x] **Step 3: Implement session factory**

Move PTY session construction into `_create_session(profile)` and pass `cwd=self._workspace_path`.

- [x] **Step 4: Run tests to verify GREEN**

Run: `python -m pytest tests/test_main_window.py -v`

Expected: PASS.

## Self-Review Notes

- This plan keeps workspace selection in the HMI only. It does not add recent-workspace persistence yet.
- Logs move from process-relative `.agenthub/runs` to workspace-relative `<workspace>/.agenthub/runs`.
