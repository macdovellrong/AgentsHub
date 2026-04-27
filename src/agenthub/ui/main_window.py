from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtCore import QTimer
from PySide6.QtGui import QTextCursor
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QPlainTextEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from agenthub.adapters.profiles import DEFAULT_AGENT_PROFILES, AgentProfile
from agenthub.process.interactive_pty import InteractivePtySession
from agenthub.storage.run_logs import RunLogWriter
from agenthub.ui.output_buffer import OutputBuffer


class MainWindow(QMainWindow):
    def __init__(
        self,
        profiles: tuple[AgentProfile, ...] = DEFAULT_AGENT_PROFILES,
        workspace_path: Path | str | None = None,
        log_root: Path | str | None = None,
    ) -> None:
        super().__init__()
        self.setWindowTitle("AgentHub")
        self._profiles = profiles
        self._workspace_path = Path.cwd() if workspace_path is None else Path(workspace_path)
        self._explicit_log_root = log_root is not None
        self._log_root = Path(log_root) if log_root is not None else self._default_log_root()
        self._log_writer: RunLogWriter | None = None
        self._active_profile: AgentProfile | None = None
        self._session: InteractivePtySession | None = None
        self._output_buffer = OutputBuffer(max_chars=200_000)
        self._flush_timer = QTimer(self)
        self._flush_timer.setInterval(50)
        self._flush_timer.timeout.connect(self._drain_session)

        self.status_label = QLabel("未连接")
        self.workspace_label = QLabel()
        self.choose_workspace_button = QPushButton("选择目录")
        self.agent_combo = QComboBox()
        for profile in self._profiles:
            self.agent_combo.addItem(profile.display_name, profile.id)
        self.start_button = QPushButton("启动")
        self.stop_button = QPushButton("停止")
        self.command_input = QLineEdit()
        self.send_button = QPushButton("发送")
        self.terminal = QPlainTextEdit()
        self.terminal.setReadOnly(True)
        self.terminal.setLineWrapMode(QPlainTextEdit.LineWrapMode.NoWrap)

        top_bar = QHBoxLayout()
        top_bar.addWidget(self.status_label)
        top_bar.addStretch(1)
        top_bar.addWidget(QLabel("Workspace"))
        top_bar.addWidget(self.workspace_label, 1)
        top_bar.addWidget(self.choose_workspace_button)
        top_bar.addWidget(QLabel("Agent"))
        top_bar.addWidget(self.agent_combo)
        top_bar.addWidget(self.start_button)
        top_bar.addWidget(self.stop_button)

        input_bar = QHBoxLayout()
        input_bar.addWidget(self.command_input, 1)
        input_bar.addWidget(self.send_button)

        layout = QVBoxLayout()
        layout.addLayout(top_bar)
        layout.addWidget(self.terminal, 1)
        layout.addLayout(input_bar)

        container = QWidget()
        container.setLayout(layout)
        self.setCentralWidget(container)

        self.start_button.clicked.connect(self.start_session)
        self.stop_button.clicked.connect(self.stop_session)
        self.send_button.clicked.connect(self.send_command)
        self.command_input.returnPressed.connect(self.send_command)
        self.choose_workspace_button.clicked.connect(self.choose_workspace)
        self.agent_combo.currentIndexChanged.connect(self._sync_agent_placeholder)
        self._sync_workspace_label()
        self._sync_agent_placeholder()
        self._sync_controls()

    def start_session(self) -> None:
        if self._session is not None and self._session.is_alive():
            return
        profile = self.selected_profile()
        self._session = self._create_session(profile)
        try:
            self._session.start()
        except Exception as exc:
            self._session = None
            self._append_text(f"启动失败: {exc}\n")
            self._sync_controls()
            return
        try:
            self._log_writer = RunLogWriter.create(
                root=self._log_root,
                profile_id=profile.id,
            )
        except Exception as exc:
            self._session.stop()
            self._session = None
            self._append_text(f"日志启动失败: {exc}\n")
            self._sync_controls()
            return
        self._active_profile = profile
        self.status_label.setText(f"{profile.display_name} 在线")
        self._append_text(f"日志目录: {self._log_writer.paths.run_dir}\n")
        self._flush_timer.start()
        self._sync_controls()

    def stop_session(self) -> None:
        if self._session is None:
            return
        try:
            if (
                self._session.is_alive()
                and self._active_profile is not None
                and self._active_profile.id == "powershell"
            ):
                self._session.write("exit\r\n")
        finally:
            self._session.stop()
            self._drain_session()
            self._session = None
            if self._log_writer is not None:
                self._log_writer.close()
                self._log_writer = None
            self._active_profile = None
            self._flush_timer.stop()
            self.status_label.setText("已停止")
            self._sync_controls()

    def send_command(self) -> None:
        if self._session is None or not self._session.is_alive():
            return
        text = self.command_input.text().strip()
        if not text:
            return
        self._session.write(text + "\r\n")
        self.command_input.clear()

    def closeEvent(self, event) -> None:  # noqa: N802
        self.stop_session()
        super().closeEvent(event)

    def selected_profile(self) -> AgentProfile:
        index = self.agent_combo.currentIndex()
        return self._profiles[index]

    @property
    def workspace_path(self) -> Path:
        return self._workspace_path

    @property
    def log_root(self) -> Path:
        return self._log_root

    def set_workspace(self, path: Path | str) -> None:
        self._workspace_path = Path(path)
        if not self._explicit_log_root:
            self._log_root = self._default_log_root()
        self._sync_workspace_label()

    def choose_workspace(self) -> None:
        selected = QFileDialog.getExistingDirectory(
            self,
            "选择工作区",
            str(self._workspace_path),
        )
        if selected:
            self.set_workspace(selected)

    def _create_session(self, profile: AgentProfile) -> InteractivePtySession:
        return InteractivePtySession(
            run_id=f"hmi-{profile.id}",
            command=profile.command,
            cwd=self._workspace_path,
        )

    def _drain_session(self) -> None:
        if self._session is None:
            return
        for event in self._session.drain():
            if self._log_writer is not None:
                self._log_writer.append(event)
            self._output_buffer.append(event)
        text = self._output_buffer.flush_text()
        if text:
            self._append_text(text)
        if not self._session.is_alive():
            self.status_label.setText("进程已退出")
            if self._log_writer is not None:
                self._log_writer.close()
                self._log_writer = None
            self._flush_timer.stop()
            self._sync_controls()

    def _append_text(self, text: str) -> None:
        cursor = self.terminal.textCursor()
        cursor.movePosition(QTextCursor.MoveOperation.End)
        cursor.insertText(text)
        self.terminal.setTextCursor(cursor)
        self.terminal.ensureCursorVisible()

    def _sync_controls(self) -> None:
        connected = self._session is not None and self._session.is_alive()
        self.choose_workspace_button.setEnabled(not connected)
        self.agent_combo.setEnabled(not connected)
        self.start_button.setEnabled(not connected)
        self.stop_button.setEnabled(connected)
        self.command_input.setEnabled(connected)
        self.send_button.setEnabled(connected)

    def _sync_agent_placeholder(self) -> None:
        self.command_input.setPlaceholderText(self.selected_profile().placeholder)

    def _sync_workspace_label(self) -> None:
        self.workspace_label.setText(str(self._workspace_path))

    def _default_log_root(self) -> Path:
        return self._workspace_path / ".agenthub" / "runs"


def run_hmi(argv: list[str] | None = None) -> int:
    app = QApplication(sys.argv if argv is None else argv)
    window = MainWindow()
    window.resize(1000, 680)
    window.show()
    return app.exec()
