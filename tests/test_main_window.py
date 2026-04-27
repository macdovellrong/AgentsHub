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
