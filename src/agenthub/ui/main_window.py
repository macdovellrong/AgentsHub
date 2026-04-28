from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QTextCursor
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QPlainTextEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from agenthub.adapters.profiles import DEFAULT_AGENT_PROFILES, AgentProfile
from agenthub.process.interactive_pty import InteractivePtySession
from agenthub.storage.run_index import RunIndexStore, RunRecord, RunStatus
from agenthub.storage.run_logs import RunLogWriter
from agenthub.storage.settings import SettingsStore
from agenthub.ui.output_buffer import OutputBuffer


class MainWindow(QMainWindow):
    def __init__(
        self,
        profiles: tuple[AgentProfile, ...] = DEFAULT_AGENT_PROFILES,
        workspace_path: Path | str | None = None,
        log_root: Path | str | None = None,
        settings_store: SettingsStore | None = None,
    ) -> None:
        super().__init__()
        self.setWindowTitle("AgentHub")
        self._profiles = profiles
        self._settings_store = settings_store
        self._workspace_path = self._initial_workspace(workspace_path)
        self._explicit_log_root = log_root is not None
        self._log_root = Path(log_root) if log_root is not None else self._default_log_root()
        self._log_writer: RunLogWriter | None = None
        self._run_index_store: RunIndexStore | None = None
        self._active_run_id: str | None = None
        self._active_profile: AgentProfile | None = None
        self._session: InteractivePtySession | None = None
        self._output_buffer = OutputBuffer(max_chars=200_000)
        self._flush_timer = QTimer(self)
        self._flush_timer.setInterval(50)
        self._flush_timer.timeout.connect(self._drain_session)

        self.status_label = QLabel("未连接")
        self.workspace_label = QLabel()
        self.recent_workspace_combo = QComboBox()
        self.choose_workspace_button = QPushButton("选择目录")
        self.agent_combo = QComboBox()
        for profile in self._profiles:
            self.agent_combo.addItem(profile.display_name, profile.id)
        self.start_button = QPushButton("启动")
        self.stop_button = QPushButton("停止")
        self.command_input = QLineEdit()
        self.send_button = QPushButton("发送")
        self.refresh_history_button = QPushButton("刷新历史")
        self.view_clean_button = QPushButton("查看 clean")
        self.view_raw_button = QPushButton("查看 raw")
        self.history_list = QListWidget()
        self.history_list.setMaximumHeight(140)
        self.terminal = QPlainTextEdit()
        self.terminal.setReadOnly(True)
        self.terminal.setLineWrapMode(QPlainTextEdit.LineWrapMode.NoWrap)

        top_bar = QHBoxLayout()
        top_bar.addWidget(self.status_label)
        top_bar.addStretch(1)
        top_bar.addWidget(QLabel("Workspace"))
        top_bar.addWidget(self.workspace_label, 1)
        top_bar.addWidget(QLabel("最近"))
        top_bar.addWidget(self.recent_workspace_combo)
        top_bar.addWidget(self.choose_workspace_button)
        top_bar.addWidget(QLabel("Agent"))
        top_bar.addWidget(self.agent_combo)
        top_bar.addWidget(self.start_button)
        top_bar.addWidget(self.stop_button)

        input_bar = QHBoxLayout()
        input_bar.addWidget(self.command_input, 1)
        input_bar.addWidget(self.send_button)

        history_bar = QHBoxLayout()
        history_bar.addWidget(QLabel("历史 Runs"))
        history_bar.addStretch(1)
        history_bar.addWidget(self.refresh_history_button)
        history_bar.addWidget(self.view_clean_button)
        history_bar.addWidget(self.view_raw_button)

        layout = QVBoxLayout()
        layout.addLayout(top_bar)
        layout.addWidget(self.terminal, 1)
        layout.addLayout(history_bar)
        layout.addWidget(self.history_list)
        layout.addLayout(input_bar)

        container = QWidget()
        container.setLayout(layout)
        self.setCentralWidget(container)

        self.start_button.clicked.connect(self.start_session)
        self.stop_button.clicked.connect(self.stop_session)
        self.send_button.clicked.connect(self.send_command)
        self.command_input.returnPressed.connect(self.send_command)
        self.refresh_history_button.clicked.connect(self.refresh_run_history)
        self.view_clean_button.clicked.connect(self.load_selected_clean_log)
        self.view_raw_button.clicked.connect(self.load_selected_raw_log)
        self.history_list.itemDoubleClicked.connect(
            lambda _item: self.load_selected_clean_log()
        )
        self.history_list.currentItemChanged.connect(
            lambda _current, _previous: self._sync_history_controls()
        )
        self.choose_workspace_button.clicked.connect(self.choose_workspace)
        self.recent_workspace_combo.activated.connect(self._select_recent_workspace)
        self.agent_combo.currentIndexChanged.connect(self._sync_agent_placeholder)
        self._sync_workspace_label()
        self._sync_recent_workspaces()
        self.refresh_run_history()
        self._sync_agent_placeholder()
        self._sync_controls()

    def start_session(self) -> None:
        if self._session is not None and self._session.is_alive():
            return
        profile = self.selected_profile()
        try:
            self._log_writer = RunLogWriter.create(
                root=self._log_root,
                profile_id=profile.id,
            )
            self._run_index_store = RunIndexStore.for_workspace(self._workspace_path)
            self._active_run_id = self._log_writer.paths.run_id
            self._run_index_store.create_run(
                profile_id=profile.id,
                profile_name=profile.display_name,
                workspace_path=self._workspace_path,
                log_paths=self._log_writer.paths,
                status=RunStatus.STARTING,
            )
        except Exception as exc:
            self._cleanup_inactive_run()
            self._append_text(f"运行记录启动失败: {exc}\n")
            self._sync_controls()
            return

        self._session = self._create_session(profile, run_id=self._active_run_id)
        try:
            self._session.start()
        except Exception as exc:
            self._finish_active_run(RunStatus.START_FAILED, error_message=str(exc))
            self._session = None
            self._append_text(f"启动失败: {exc}\n")
            self._sync_controls()
            return

        self._mark_active_run(RunStatus.RUNNING)
        self.refresh_run_history()
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
            self._drain_session(mark_exited=False)
            self._session = None
            self._finish_active_run(RunStatus.STOPPED)
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
        if self._settings_store is not None:
            self._settings_store.record_workspace(self._workspace_path)
        self._sync_workspace_label()
        self._sync_recent_workspaces()
        self.refresh_run_history()

    def choose_workspace(self) -> None:
        selected = QFileDialog.getExistingDirectory(
            self,
            "选择工作区",
            str(self._workspace_path),
        )
        if selected:
            self.set_workspace(selected)

    def refresh_run_history(self) -> None:
        self.history_list.clear()
        try:
            records = RunIndexStore.for_workspace(self._workspace_path).list_records()
        except Exception as exc:
            self._append_text(f"加载历史 runs 失败: {exc}\n")
            self._sync_history_controls()
            return

        for record in sorted(records, key=lambda item: item.started_at, reverse=True):
            list_item = QListWidgetItem(self._format_run_record(record))
            list_item.setData(Qt.ItemDataRole.UserRole, record)
            self.history_list.addItem(list_item)

        if self.history_list.count() > 0:
            self.history_list.setCurrentRow(0)
        self._sync_history_controls()

    def load_selected_clean_log(self) -> None:
        self._load_selected_history_log("clean")

    def load_selected_raw_log(self) -> None:
        self._load_selected_history_log("raw")

    def selected_history_record(self) -> RunRecord | None:
        item = self.history_list.currentItem()
        if item is None:
            return None
        record = item.data(Qt.ItemDataRole.UserRole)
        if isinstance(record, RunRecord):
            return record
        return None

    def _create_session(
        self,
        profile: AgentProfile,
        run_id: str | None = None,
    ) -> InteractivePtySession:
        return InteractivePtySession(
            run_id=run_id or f"hmi-{profile.id}",
            command=profile.command,
            cwd=self._workspace_path,
        )

    def _drain_session(self, mark_exited: bool = True) -> None:
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
            if mark_exited:
                self._finish_active_run(RunStatus.EXITED)
            self._flush_timer.stop()
            self._sync_controls()

    def _mark_active_run(
        self,
        status: RunStatus,
        *,
        error_message: str | None = None,
    ) -> None:
        if self._run_index_store is None or self._active_run_id is None:
            return
        try:
            self._run_index_store.update_status(
                self._active_run_id,
                status,
                error_message=error_message,
            )
        except Exception as exc:
            self._append_text(f"运行记录更新失败: {exc}\n")

    def _finish_active_run(
        self,
        status: RunStatus,
        *,
        error_message: str | None = None,
    ) -> None:
        self._mark_active_run(status, error_message=error_message)
        self._cleanup_inactive_run()
        self.refresh_run_history()

    def _cleanup_inactive_run(self) -> None:
        if self._log_writer is not None:
            self._log_writer.close()
            self._log_writer = None
        self._run_index_store = None
        self._active_run_id = None

    def _append_text(self, text: str) -> None:
        cursor = self.terminal.textCursor()
        cursor.movePosition(QTextCursor.MoveOperation.End)
        cursor.insertText(text)
        self.terminal.setTextCursor(cursor)
        self.terminal.ensureCursorVisible()

    def _sync_controls(self) -> None:
        connected = self._session is not None and self._session.is_alive()
        self.choose_workspace_button.setEnabled(not connected)
        self.recent_workspace_combo.setEnabled(
            not connected and self.recent_workspace_combo.count() > 0
        )
        self.agent_combo.setEnabled(not connected)
        self.start_button.setEnabled(not connected)
        self.stop_button.setEnabled(connected)
        self.command_input.setEnabled(connected)
        self.send_button.setEnabled(connected)
        self._sync_history_controls()

    def _sync_history_controls(self) -> None:
        has_selection = self.selected_history_record() is not None
        self.view_clean_button.setEnabled(has_selection)
        self.view_raw_button.setEnabled(has_selection)

    def _sync_agent_placeholder(self) -> None:
        self.command_input.setPlaceholderText(self.selected_profile().placeholder)

    def _sync_workspace_label(self) -> None:
        self.workspace_label.setText(str(self._workspace_path))

    def _sync_recent_workspaces(self) -> None:
        self.recent_workspace_combo.blockSignals(True)
        self.recent_workspace_combo.clear()
        if self._settings_store is not None:
            for path in self._settings_store.load().recent_workspaces:
                self.recent_workspace_combo.addItem(str(path), str(path))
        self.recent_workspace_combo.blockSignals(False)
        self.recent_workspace_combo.setEnabled(self.recent_workspace_combo.count() > 0)

    def _select_recent_workspace(self, index: int) -> None:
        selected = self.recent_workspace_combo.itemData(index)
        if selected:
            self.set_workspace(selected)

    def _load_selected_history_log(self, kind: str) -> None:
        record = self.selected_history_record()
        if record is None:
            return
        path = record.clean_log_path if kind == "clean" else record.raw_log_path
        try:
            text = path.read_text(encoding="utf-8")
        except Exception as exc:
            self.terminal.setPlainText(f"加载 {path.name} 失败: {exc}\n")
            return
        self.terminal.setPlainText(text)
        self.terminal.moveCursor(QTextCursor.MoveOperation.End)

    def _format_run_record(self, record: RunRecord) -> str:
        ended_at = record.ended_at or "running"
        return (
            f"{record.started_at} | {record.profile_name} | "
            f"{record.status.value} | {ended_at} | {record.run_id}"
        )

    def _default_log_root(self) -> Path:
        return self._workspace_path / ".agenthub" / "runs"

    def _initial_workspace(self, explicit_workspace: Path | str | None) -> Path:
        if explicit_workspace is not None:
            return Path(explicit_workspace)
        if self._settings_store is not None:
            last_workspace = self._settings_store.load().last_workspace
            if last_workspace is not None:
                return last_workspace
        return Path.cwd()


def run_hmi(argv: list[str] | None = None) -> int:
    app = QApplication(sys.argv if argv is None else argv)
    window = MainWindow(settings_store=SettingsStore.default())
    window.resize(1000, 680)
    window.show()
    return app.exec()
