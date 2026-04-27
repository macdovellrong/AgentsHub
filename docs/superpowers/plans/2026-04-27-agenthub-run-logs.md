# AgentHub Run Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist raw and clean PTY output for HMI-managed agent sessions.

**Architecture:** Keep logging as a small storage helper that receives normalized `OutputEvent` objects. The HMI creates one `RunLogWriter` per started session and appends every drained PTY event to both `raw.log` and `clean.log`.

**Tech Stack:** Python 3.11+, pathlib, pytest.

---

## File Structure

- `src/agenthub/storage/run_logs.py`: creates run directories and appends raw/clean log files.
- `src/agenthub/storage/__init__.py`: storage package marker.
- `src/agenthub/ui/main_window.py`: create and close one `RunLogWriter` per session.
- `tests/test_run_logs.py`: file logging behavior tests.
- `tests/test_main_window.py`: HMI logging integration test with a fake session.
- `.gitignore`: exclude generated `.agenthub/` logs.
- `README.md`: document log paths.

## Task 1: Run Log Writer

- [x] **Step 1: Write failing tests**

Verify that `RunLogWriter` creates a run directory and writes raw and clean event text to separate files.

- [x] **Step 2: Run tests to verify RED**

Run: `python -m pytest tests/test_run_logs.py -v`

Expected: FAIL because `agenthub.storage.run_logs` does not exist.

- [x] **Step 3: Implement writer**

Create `RunLogPaths` and `RunLogWriter.create/append/close`.

- [x] **Step 4: Run tests to verify GREEN**

Run: `python -m pytest tests/test_run_logs.py -v`

Expected: PASS.

## Task 2: HMI Integration

- [x] **Step 1: Write failing HMI integration test**

Verify `_drain_session()` writes drained `OutputEvent` objects to the active run log writer.

- [x] **Step 2: Run tests to verify RED**

Run: `python -m pytest tests/test_main_window.py -v`

Expected: FAIL because `MainWindow` has no `log_root` or `_log_writer`.

- [x] **Step 3: Wire logger into HMI**

Create a writer after a session starts, append drained events, close the writer when the session stops, and show the log directory in the terminal output.

- [x] **Step 4: Run tests to verify GREEN**

Run: `python -m pytest tests/test_main_window.py tests/test_run_logs.py -v`

Expected: PASS.

## Self-Review Notes

- This plan intentionally avoids SQLite. File logs are the first durable artifact layer.
- PTY logs use `raw.log` and `clean.log` because ConPTY exposes one merged terminal stream.
