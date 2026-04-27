import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication

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
