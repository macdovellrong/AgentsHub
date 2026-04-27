# AgentHub Manual Codex Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual Codex PTY session support to the existing HMI without introducing automatic orchestration.

**Architecture:** Define agent launch profiles separately from the UI, then let `MainWindow` start the selected profile through the existing `InteractivePtySession`. PowerShell and Codex share the same PTY output path, send box, and throttled display buffer.

**Tech Stack:** Python 3.11+, pywinpty, PySide6 Qt Widgets, pytest.

---

## File Structure

- `src/agenthub/adapters/profiles.py`: default PowerShell and Codex launch profiles.
- `src/agenthub/ui/main_window.py`: add agent selector and start selected profile.
- `tests/test_agent_profiles.py`: profile command tests.
- `tests/test_main_window.py`: UI selector tests.
- `README.md`: manual Codex HMI instructions.

## Task 1: Agent Profiles

- [x] **Step 1: Write failing profile tests**

Verify default profiles include `powershell` and `codex`, and that Codex uses a PowerShell launcher instead of `cmd.exe` for UNC workspace compatibility.

- [x] **Step 2: Run tests to verify RED**

Run: `python -m pytest tests/test_agent_profiles.py -v`

Expected: FAIL because `agenthub.adapters.profiles` does not exist.

- [x] **Step 3: Implement profiles**

Create `AgentProfile`, `DEFAULT_AGENT_PROFILES`, and `profile_by_id`.

- [x] **Step 4: Run tests to verify GREEN**

Run: `python -m pytest tests/test_agent_profiles.py -v`

Expected: PASS.

## Task 2: HMI Agent Selector

- [x] **Step 1: Write failing UI tests**

Verify `MainWindow` exposes `agent_combo`, lists `PowerShell` and `Codex`, and updates the input placeholder when Codex is selected.

- [x] **Step 2: Run tests to verify RED**

Run: `python -m pytest tests/test_main_window.py -v`

Expected: FAIL because `agent_combo` does not exist.

- [x] **Step 3: Implement selector**

Add a `QComboBox`, wire it to profiles, and start the selected profile command through `InteractivePtySession`.

- [x] **Step 4: Run tests to verify GREEN**

Run: `python -m pytest tests/test_main_window.py tests/test_agent_profiles.py -v`

Expected: PASS.

## Self-Review Notes

- This plan intentionally excludes automatic orchestration, structured task routing, and persistent Codex logs.
- Codex is launched through PowerShell because the current workspace is a UNC path and `cmd.exe` cannot use UNC as the current directory.
