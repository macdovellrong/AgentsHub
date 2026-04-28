from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QFont, QTextCursor
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QFileDialog,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QPlainTextEdit,
    QPushButton,
    QSplitter,
    QVBoxLayout,
    QWidget,
)

from agenthub.adapters.profiles import DEFAULT_AGENT_PROFILES, AgentProfile
from agenthub.process.interactive_pty import InteractivePtySession
from agenthub.storage.run_index import RunIndexStore, RunRecord, RunStatus
from agenthub.storage.run_logs import RunLogWriter
from agenthub.storage.settings import SettingsStore
from agenthub.storage.tasks import TaskRecord, TaskStatus, TaskStore
from agenthub.ui.agent_session import (
    AgentSessionState,
    AgentSessionStatus,
    create_agent_states,
)
from agenthub.ui.chat import (
    ChatMessageKind,
    format_chat_message,
    new_chat_message,
    parse_routed_input,
)


TASK_STATUS_LABELS = {
    TaskStatus.PENDING: "待处理",
    TaskStatus.RUNNING: "运行中",
    TaskStatus.REVIEW: "复查",
    TaskStatus.DONE: "完成",
    TaskStatus.FAILED: "失败",
}


MAIN_WINDOW_STYLESHEET = """
QMainWindow, QWidget#appRoot {
    background: #111418;
    color: #e6eaf0;
}
QLabel {
    color: #cfd6df;
}
QLabel#statusLabel {
    color: #9fe6b8;
    font-weight: 600;
    padding: 4px 10px;
    border: 1px solid #244c34;
    border-radius: 6px;
    background: #132119;
}
QPushButton {
    background: #253140;
    color: #f4f7fb;
    border: 1px solid #344457;
    border-radius: 5px;
    padding: 6px 12px;
}
QPushButton:hover {
    background: #304056;
}
QPushButton:disabled {
    color: #748091;
    background: #1a2029;
    border-color: #252d38;
}
QComboBox, QLineEdit, QListWidget {
    background: #171d25;
    color: #eef2f6;
    border: 1px solid #303a48;
    border-radius: 5px;
    padding: 5px;
    selection-background-color: #355f8c;
}
QGroupBox {
    border: 1px solid #2b3542;
    border-radius: 6px;
    margin-top: 10px;
    padding: 8px;
    font-weight: 600;
}
QGroupBox::title {
    subcontrol-origin: margin;
    left: 8px;
    padding: 0 4px;
    color: #aeb8c6;
}
QSplitter::handle {
    background: #202833;
}
QPlainTextEdit#chatTimeline {
    background: #070a0d;
    color: #d8f3dc;
    border: 1px solid #28313d;
    border-radius: 6px;
    padding: 8px;
    selection-background-color: #2f5d46;
}
"""


class TerminalPane(QPlainTextEdit):
    _KEY_SEQUENCES = {
        Qt.Key.Key_Return: "\r",
        Qt.Key.Key_Enter: "\r",
        Qt.Key.Key_Backspace: "\x7f",
        Qt.Key.Key_Tab: "\t",
        Qt.Key.Key_Escape: "\x1b",
        Qt.Key.Key_Up: "\x1b[A",
        Qt.Key.Key_Down: "\x1b[B",
        Qt.Key.Key_Right: "\x1b[C",
        Qt.Key.Key_Left: "\x1b[D",
        Qt.Key.Key_Home: "\x1b[H",
        Qt.Key.Key_End: "\x1b[F",
        Qt.Key.Key_Delete: "\x1b[3~",
        Qt.Key.Key_PageUp: "\x1b[5~",
        Qt.Key.Key_PageDown: "\x1b[6~",
    }

    def __init__(self) -> None:
        super().__init__()
        self._input_handler: Callable[[str], None] | None = None
        self._terminal_input_enabled = False
        self.setReadOnly(True)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.setUndoRedoEnabled(False)

    def set_input_handler(self, handler: Callable[[str], None]) -> None:
        self._input_handler = handler

    def set_terminal_input_enabled(self, enabled: bool) -> None:
        self._terminal_input_enabled = enabled

    def keyPressEvent(self, event) -> None:  # noqa: N802
        text = self._terminal_text_for_event(event)
        if text is not None:
            self._send_terminal_text(text)
            event.accept()
            return
        super().keyPressEvent(event)

    def insertFromMimeData(self, source) -> None:  # noqa: N802
        if (
            self._terminal_input_enabled
            and self._input_handler is not None
            and source.hasText()
        ):
            text = _normalize_terminal_input(source.text())
            self._send_terminal_text(text)
            return
        super().insertFromMimeData(source)

    def _terminal_text_for_event(self, event) -> str | None:
        if not self._terminal_input_enabled or self._input_handler is None:
            return None
        if event.modifiers() & Qt.KeyboardModifier.ControlModifier:
            control = _control_sequence_for_key(event.key())
            if control is not None:
                return control
        if event.key() in self._KEY_SEQUENCES:
            return self._KEY_SEQUENCES[event.key()]
        text = event.text()
        if text and not text.isspace():
            return text
        if text == " ":
            return text
        return None

    def _send_terminal_text(self, text: str) -> None:
        if self._input_handler is not None and text:
            self._input_handler(text)


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
        self._agent_states = create_agent_states(self._profiles)
        self._default_agent_id = self._derive_default_agent_id(self._profiles)
        self._settings_store = settings_store
        self._workspace_path = self._initial_workspace(workspace_path)
        self._explicit_log_root = log_root is not None
        self._log_root = Path(log_root) if log_root is not None else self._default_log_root()
        self._flush_timer = QTimer(self)
        self._flush_timer.setInterval(50)
        self._flush_timer.timeout.connect(self._drain_session)

        self.status_label = QLabel("未连接")
        self.status_label.setObjectName("statusLabel")
        self.workspace_label = QLabel()
        self.recent_workspace_combo = QComboBox()
        self.choose_workspace_button = QPushButton("选择目录")
        self.agent_combo = QComboBox()
        for profile in self._profiles:
            self.agent_combo.addItem(profile.display_name, profile.id)
        self.agent_combo.hide()
        self.start_button = QPushButton("启动")
        self.stop_button = QPushButton("停止")
        self.command_input = QLineEdit()
        self.send_button = QPushButton("发送")
        self.refresh_history_button = QPushButton("刷新历史")
        self.view_clean_button = QPushButton("查看 clean")
        self.view_raw_button = QPushButton("查看 raw")
        self.history_list = QListWidget()
        self.history_list.setMaximumHeight(140)
        self.refresh_tasks_button = QPushButton("刷新任务")
        self.task_lists: dict[TaskStatus, QListWidget] = {}
        for status in TaskStatus:
            task_list = QListWidget()
            task_list.setMinimumWidth(140)
            task_list.setMinimumHeight(72)
            self.task_lists[status] = task_list
        self.agent_list = QListWidget()
        self.agent_list.setObjectName("agentRoster")
        self.agent_list.setMinimumWidth(180)
        self.chat_timeline = TerminalPane()
        self.chat_timeline.setObjectName("chatTimeline")
        self.chat_timeline.setFont(QFont("Consolas", 10))
        self.chat_timeline.set_input_handler(self._write_terminal_input)
        self.chat_timeline.setPlaceholderText("Agent 输出会显示在这里")
        self.chat_timeline.setLineWrapMode(QPlainTextEdit.LineWrapMode.WidgetWidth)
        self.terminal = self.chat_timeline
        self.terminal.setPlaceholderText("Agent 输出会显示在这里")

        top_bar = QHBoxLayout()
        top_bar.addWidget(self.status_label)
        top_bar.addStretch(1)
        top_bar.addWidget(QLabel("Workspace"))
        top_bar.addWidget(self.workspace_label, 1)
        top_bar.addWidget(QLabel("最近"))
        top_bar.addWidget(self.recent_workspace_combo)
        top_bar.addWidget(self.choose_workspace_button)
        top_bar.addWidget(self.agent_combo)

        input_bar = QHBoxLayout()
        input_bar.addWidget(self.command_input, 1)
        input_bar.addWidget(self.send_button)

        history_bar = QHBoxLayout()
        history_bar.addWidget(QLabel("历史 Runs"))
        history_bar.addStretch(1)
        history_bar.addWidget(self.refresh_history_button)
        history_bar.addWidget(self.view_clean_button)
        history_bar.addWidget(self.view_raw_button)

        task_bar = QHBoxLayout()
        task_bar.addWidget(QLabel("任务看板"))
        task_bar.addStretch(1)
        task_bar.addWidget(self.refresh_tasks_button)

        task_board = QVBoxLayout()
        for status in TaskStatus:
            group = QGroupBox(TASK_STATUS_LABELS[status])
            group_layout = QVBoxLayout()
            group_layout.addWidget(self.task_lists[status])
            group.setLayout(group_layout)
            task_board.addWidget(group)

        agent_bar = QHBoxLayout()
        agent_bar.addWidget(QLabel("Agent"))
        agent_bar.addStretch(1)
        agent_bar.addWidget(self.start_button)
        agent_bar.addWidget(self.stop_button)

        left_panel = QWidget()
        left_panel.setObjectName("taskPanel")
        left_layout = QVBoxLayout()
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.addLayout(agent_bar)
        left_layout.addWidget(self.agent_list, 1)
        left_layout.addLayout(task_bar)
        left_layout.addLayout(task_board)
        left_panel.setLayout(left_layout)

        terminal_panel = QWidget()
        terminal_panel.setObjectName("terminalPanel")
        terminal_layout = QVBoxLayout()
        terminal_layout.setContentsMargins(0, 0, 0, 0)
        terminal_layout.addWidget(QLabel("共享聊天"))
        terminal_layout.addWidget(self.chat_timeline, 1)
        terminal_layout.addLayout(input_bar)
        terminal_panel.setLayout(terminal_layout)

        history_panel = QWidget()
        history_panel.setObjectName("historyPanel")
        history_layout = QVBoxLayout()
        history_layout.setContentsMargins(0, 0, 0, 0)
        history_layout.addLayout(history_bar)
        history_layout.addWidget(self.history_list, 1)
        history_panel.setLayout(history_layout)

        self._workspace_splitter = QSplitter(Qt.Orientation.Horizontal)
        self._workspace_splitter.addWidget(left_panel)
        self._workspace_splitter.addWidget(terminal_panel)
        self._workspace_splitter.addWidget(history_panel)
        self._workspace_splitter.setStretchFactor(0, 0)
        self._workspace_splitter.setStretchFactor(1, 1)
        self._workspace_splitter.setStretchFactor(2, 0)
        self._workspace_splitter.setSizes([260, 720, 320])

        layout = QVBoxLayout()
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(10)
        layout.addLayout(top_bar)
        layout.addWidget(self._workspace_splitter, 1)

        container = QWidget()
        container.setObjectName("appRoot")
        container.setLayout(layout)
        self.setCentralWidget(container)
        self.setStyleSheet(MAIN_WINDOW_STYLESHEET)

        self.start_button.clicked.connect(self.start_session)
        self.stop_button.clicked.connect(self.stop_session)
        self.send_button.clicked.connect(self.send_command)
        self.command_input.returnPressed.connect(self.send_command)
        self.refresh_tasks_button.clicked.connect(self.refresh_tasks)
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
        self.agent_list.currentRowChanged.connect(self._select_agent_row)
        self._sync_workspace_label()
        self._sync_recent_workspaces()
        self.refresh_tasks()
        self.refresh_run_history()
        self._sync_agent_placeholder()
        self._refresh_agent_roster()
        self._sync_controls()

    def start_session(self) -> None:
        state = self.selected_agent_state()
        if state.is_alive():
            return
        profile = state.profile
        try:
            state.log_writer = RunLogWriter.create(
                root=self._log_root,
                profile_id=profile.id,
            )
            state.run_index_store = RunIndexStore.for_workspace(self._workspace_path)
            state.run_id = state.log_writer.paths.run_id
            state.run_index_store.create_run(
                profile_id=profile.id,
                profile_name=profile.display_name,
                workspace_path=self._workspace_path,
                log_paths=state.log_writer.paths,
                status=RunStatus.STARTING,
            )
            state.status = AgentSessionStatus.STARTING
        except Exception as exc:
            self._finish_agent_run(state, RunStatus.START_FAILED, error_message=str(exc))
            state.status = AgentSessionStatus.START_FAILED
            self._append_system_message(
                f"{profile.display_name} 运行记录启动失败: {exc}"
            )
            self._refresh_agent_roster()
            self._sync_controls()
            return

        state.session = self._create_session(profile, run_id=state.run_id)
        try:
            state.session.start()
        except Exception as exc:
            self._finish_agent_run(state, RunStatus.START_FAILED, error_message=str(exc))
            state.session = None
            state.status = AgentSessionStatus.START_FAILED
            self._append_system_message(f"{profile.display_name} 启动失败: {exc}")
            self._refresh_agent_roster()
            self._sync_controls()
            return

        self._mark_agent_run(state, RunStatus.RUNNING)
        state.status = AgentSessionStatus.RUNNING
        state.output_buffer.reset()
        if state.log_writer is not None:
            self._append_system_message(
                f"{profile.display_name} 已启动，日志目录: {state.log_writer.paths.run_dir}"
            )
        self.refresh_run_history()
        self.terminal.setFocus()
        self._flush_timer.start()
        self._refresh_agent_roster()
        self._sync_controls()

    def stop_session(self) -> None:
        state = self.selected_agent_state()
        if state.session is None:
            return
        try:
            if state.session.is_alive() and state.profile.id == "powershell":
                state.session.write("exit\r\n")
        finally:
            state.session.stop()
            self._drain_agent_state(state, mark_exited=False)
            state.session = None
            state.status = AgentSessionStatus.STOPPED
            self._finish_agent_run(state, RunStatus.STOPPED)
            if not self._any_session_alive():
                self._flush_timer.stop()
            self._refresh_agent_roster()
            self._sync_controls()

    def send_command(self) -> None:
        default_agent_id = self._default_agent_id or ""
        routed = parse_routed_input(
            self.command_input.text(),
            known_agent_ids=set(self._agent_states),
            default_agent_id=default_agent_id,
        )
        if routed.error_message is not None:
            self._append_system_message(routed.error_message)
            return

        target_agent_id = routed.target_agent_id
        if target_agent_id is None or target_agent_id not in self._agent_states:
            self._append_system_message("没有可用的默认 Agent")
            return

        state = self._agent_states[target_agent_id]
        if not state.is_alive():
            self._append_system_message(f"{state.profile.display_name} 未启动")
            return

        state.session.write(routed.text + "\r\n")
        self._append_chat_message(
            sender_id="user",
            sender_name=f"你 -> {state.profile.display_name}",
            text=routed.text,
            kind=ChatMessageKind.USER,
        )
        self.command_input.clear()

    def _write_terminal_input(self, text: str) -> None:
        state = self.selected_agent_state()
        if state.session is None or not state.session.is_alive():
            return
        state.session.write(text)

    def closeEvent(self, event) -> None:  # noqa: N802
        for state in self._agent_states.values():
            if state.session is not None:
                if state.session.is_alive():
                    state.session.stop()
                self._finish_agent_run(state, RunStatus.STOPPED)
                state.session = None
                state.status = AgentSessionStatus.STOPPED
        super().closeEvent(event)

    def selected_profile(self) -> AgentProfile:
        index = self.agent_combo.currentIndex()
        return self._profiles[index]

    def selected_profile_id(self) -> str:
        return self.selected_profile().id

    def selected_agent_state(self) -> AgentSessionState:
        return self._agent_states[self.selected_profile_id()]

    def _any_session_alive(self) -> bool:
        return any(state.is_alive() for state in self._agent_states.values())

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
        self.refresh_tasks()
        self.refresh_run_history()

    def choose_workspace(self) -> None:
        selected = QFileDialog.getExistingDirectory(
            self,
            "选择工作区",
            str(self._workspace_path),
        )
        if selected:
            self.set_workspace(selected)

    def refresh_tasks(self) -> None:
        for task_list in self.task_lists.values():
            task_list.clear()
        try:
            records = TaskStore.for_workspace(self._workspace_path).list_tasks()
        except Exception as exc:
            self._append_text(f"加载任务失败: {exc}\n")
            return

        for record in records:
            task_list = self.task_lists.get(record.status)
            if task_list is None:
                continue
            list_item = QListWidgetItem(self._format_task_record(record))
            list_item.setData(Qt.ItemDataRole.UserRole, record)
            task_list.addItem(list_item)

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
        for state in self._agent_states.values():
            self._drain_agent_state(state, mark_exited=mark_exited)
        if not self._any_session_alive():
            self._flush_timer.stop()
        self._sync_controls()

    def _drain_agent_state(
        self,
        state: AgentSessionState,
        mark_exited: bool = True,
    ) -> None:
        if state.session is None:
            return
        for event in state.session.drain():
            if state.log_writer is not None:
                state.log_writer.append(event)
            state.output_buffer.append(event)
        if state.output_buffer.has_pending_snapshot():
            self._append_agent_snapshot(state)
        if not state.session.is_alive():
            if mark_exited:
                self._finish_agent_run(state, RunStatus.EXITED)
            state.status = AgentSessionStatus.EXITED
            state.session = None
            self._append_system_message(f"{state.profile.display_name} 进程已退出")
            self._refresh_agent_roster()

    def _mark_agent_run(
        self,
        state: AgentSessionState,
        status: RunStatus,
        *,
        error_message: str | None = None,
    ) -> None:
        if state.run_index_store is None or state.run_id is None:
            return
        try:
            state.run_index_store.update_status(
                state.run_id,
                status,
                error_message=error_message,
            )
        except Exception as exc:
            self._append_system_message(
                f"{state.profile.display_name} 运行记录更新失败: {exc}"
            )

    def _finish_agent_run(
        self,
        state: AgentSessionState,
        status: RunStatus,
        *,
        error_message: str | None = None,
    ) -> None:
        self._mark_agent_run(state, status, error_message=error_message)
        if state.log_writer is not None:
            state.log_writer.close()
            state.log_writer = None
        state.run_index_store = None
        state.run_id = None
        self.refresh_run_history()

    def _append_text(self, text: str) -> None:
        cursor = self.terminal.textCursor()
        cursor.movePosition(QTextCursor.MoveOperation.End)
        cursor.insertText(text)
        self.terminal.setTextCursor(cursor)
        self.terminal.ensureCursorVisible()

    def _render_output_snapshot(self) -> None:
        self._append_agent_snapshot(self.selected_agent_state())

    def _append_agent_snapshot(self, state: AgentSessionState) -> None:
        text = state.output_buffer.snapshot()
        if text:
            self._append_chat_message(
                sender_id=state.profile.id,
                sender_name=state.profile.display_name,
                text=text,
                kind=ChatMessageKind.AGENT,
            )

    def _append_system_message(self, text: str) -> None:
        self._append_chat_message(
            sender_id="system",
            sender_name="系统",
            text=text,
            kind=ChatMessageKind.SYSTEM,
        )

    def _append_chat_message(
        self,
        *,
        sender_id: str,
        sender_name: str,
        text: str,
        kind: ChatMessageKind,
    ) -> None:
        message = new_chat_message(
            sender_id=sender_id,
            sender_name=sender_name,
            text=text,
            kind=kind,
        )
        self.chat_timeline.appendPlainText(format_chat_message(message))
        self.chat_timeline.appendPlainText("")
        self.chat_timeline.moveCursor(QTextCursor.MoveOperation.End)

    def _sync_controls(self) -> None:
        state = self.selected_agent_state() if self._profiles else None
        selected_connected = state.is_alive() if state is not None else False
        any_connected = self._any_session_alive()
        self.choose_workspace_button.setEnabled(not any_connected)
        self.recent_workspace_combo.setEnabled(
            not any_connected and self.recent_workspace_combo.count() > 0
        )
        self.agent_combo.setEnabled(True)
        self.start_button.setEnabled(state is not None and not selected_connected)
        self.stop_button.setEnabled(selected_connected)
        self.command_input.setEnabled(any_connected)
        self.send_button.setEnabled(any_connected)
        self.terminal.set_terminal_input_enabled(selected_connected)
        if selected_connected:
            self.status_label.setText(f"{state.profile.display_name} 在线")
        elif any_connected:
            self.status_label.setText("有 Agent 在线")
        else:
            self.status_label.setText("离线")
        self._sync_history_controls()

    def _refresh_agent_roster(self) -> None:
        current = self.agent_list.currentRow()
        self.agent_list.blockSignals(True)
        self.agent_list.clear()
        for profile in self._profiles:
            state = self._agent_states[profile.id]
            self.agent_list.addItem(f"{profile.display_name}  {state.status.value}")
        self.agent_list.blockSignals(False)
        if self.agent_list.count() > 0:
            self.agent_list.setCurrentRow(min(max(0, current), self.agent_list.count() - 1))

    def _select_agent_row(self, row: int) -> None:
        if 0 <= row < len(self._profiles):
            self.agent_combo.setCurrentIndex(row)
            self._sync_agent_placeholder()
            self._sync_controls()

    def _sync_history_controls(self) -> None:
        has_selection = self.selected_history_record() is not None
        self.view_clean_button.setEnabled(has_selection)
        self.view_raw_button.setEnabled(has_selection)

    def _sync_agent_placeholder(self) -> None:
        route_hints = " / ".join(f"@{profile.id}" for profile in self._profiles)
        default_state = (
            self._agent_states.get(self._default_agent_id)
            if self._default_agent_id is not None
            else None
        )
        if default_state is None:
            self.command_input.setPlaceholderText("没有可用 Agent，无法发送共享消息")
            return
        self.command_input.setPlaceholderText(
            f"输入共享消息，默认 {default_state.profile.display_name}；"
            f"可用 {route_hints} 定向发送"
        )

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

    def _format_task_record(self, record: TaskRecord) -> str:
        description = record.description.strip()
        if description:
            return f"{record.title}\n{description}"
        return record.title

    def _default_log_root(self) -> Path:
        return self._workspace_path / ".agenthub" / "runs"

    @staticmethod
    def _derive_default_agent_id(
        profiles: tuple[AgentProfile, ...],
    ) -> str | None:
        profile_ids = [profile.id for profile in profiles]
        if "codex" in profile_ids:
            return "codex"
        if profile_ids:
            return profile_ids[0]
        return None

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
    window.resize(1280, 760)
    window.show()
    return app.exec()


def _control_sequence_for_key(key: int) -> str | None:
    if Qt.Key.Key_A <= key <= Qt.Key.Key_Z:
        return chr(key - Qt.Key.Key_A + 1)
    if key == Qt.Key.Key_Space:
        return "\x00"
    return None


def _normalize_terminal_input(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\r")
