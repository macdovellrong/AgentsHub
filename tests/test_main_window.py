import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication

from agenthub.process.base import OutputEvent, StreamName
from agenthub.storage.run_logs import RunLogWriter
from agenthub.ui.main_window import MainWindow


def test_main_window_constructs_with_initial_controls_disabled():
    app = QApplication.instance() or QApplication([])
    window = MainWindow()
    try:
        assert window.windowTitle() == "AgentHub"
        assert window.start_button.isEnabled()
        assert not window.stop_button.isEnabled()
        assert not window.command_input.isEnabled()
        assert not window.send_button.isEnabled()
    finally:
        window.close()
        app.processEvents()


def test_main_window_lists_agent_profiles_and_updates_prompt_placeholder():
    app = QApplication.instance() or QApplication([])
    window = MainWindow()
    try:
        labels = [
            window.agent_combo.itemText(index)
            for index in range(window.agent_combo.count())
        ]

        assert labels == ["PowerShell", "Codex"]
        assert window.command_input.placeholderText() == "输入 PowerShell 命令"

        window.agent_combo.setCurrentIndex(1)

        assert window.command_input.placeholderText() == "输入 Codex prompt"
    finally:
        window.close()
        app.processEvents()


def test_main_window_writes_drained_events_to_run_log(tmp_path):
    app = QApplication.instance() or QApplication([])
    window = MainWindow(log_root=tmp_path)
    event = OutputEvent(
        run_id="hmi-powershell",
        stream=StreamName.PTY,
        raw="\x1b[32mLOG\x1b[0m\r\n",
        clean="LOG\r\n",
    )

    class FakeSession:
        def drain(self):
            return [event]

        def is_alive(self):
            return True

        def stop(self):
            pass

    window._session = FakeSession()
    window._log_writer = RunLogWriter.create(
        root=tmp_path,
        profile_id="powershell",
        run_id="hmi-powershell-test",
    )
    try:
        window._drain_session()
        window._log_writer.close()

        run_dir = tmp_path / "hmi-powershell-test"
        assert (run_dir / "raw.log").read_bytes() == "\x1b[32mLOG\x1b[0m\r\n".encode()
        assert (run_dir / "clean.log").read_bytes() == "LOG\r\n".encode()
    finally:
        window._session = None
        window.close()
        app.processEvents()


def test_main_window_uses_workspace_for_default_log_root(tmp_path):
    app = QApplication.instance() or QApplication([])
    window = MainWindow(workspace_path=tmp_path)
    try:
        assert window.workspace_path == tmp_path
        assert window.log_root == tmp_path / ".agenthub" / "runs"
        assert str(tmp_path) in window.workspace_label.text()
    finally:
        window.close()
        app.processEvents()


def test_main_window_set_workspace_updates_default_log_root(tmp_path):
    app = QApplication.instance() or QApplication([])
    initial = tmp_path / "initial"
    selected = tmp_path / "selected"
    initial.mkdir()
    selected.mkdir()
    window = MainWindow(workspace_path=initial)
    try:
        window.set_workspace(selected)

        assert window.workspace_path == selected
        assert window.log_root == selected / ".agenthub" / "runs"
        assert str(selected) in window.workspace_label.text()
    finally:
        window.close()
        app.processEvents()


def test_main_window_creates_sessions_in_selected_workspace(tmp_path):
    app = QApplication.instance() or QApplication([])
    window = MainWindow(workspace_path=tmp_path)
    try:
        session = window._create_session(window.selected_profile())

        assert session.cwd == tmp_path
    finally:
        window.close()
        app.processEvents()
