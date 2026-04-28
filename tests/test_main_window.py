import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication

from agenthub.process.base import OutputEvent, StreamName
from agenthub.storage.run_index import RunIndexStore, RunStatus
from agenthub.storage.run_logs import RunLogPaths, RunLogWriter
from agenthub.storage.settings import SettingsStore
from agenthub.storage.tasks import TaskStatus, TaskStore
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
        assert window.refresh_tasks_button.text() == "刷新任务"
        assert set(window.task_lists) == {
            TaskStatus.PENDING,
            TaskStatus.RUNNING,
            TaskStatus.REVIEW,
            TaskStatus.DONE,
            TaskStatus.FAILED,
        }
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

        assert labels == ["PowerShell", "Codex", "Claude", "Gemini"]
        assert window.command_input.placeholderText() == "输入 PowerShell 命令"

        window.agent_combo.setCurrentIndex(1)

        assert window.command_input.placeholderText() == "输入 Codex prompt"

        window.agent_combo.setCurrentIndex(2)

        assert window.command_input.placeholderText() == "输入 Claude prompt"

        window.agent_combo.setCurrentIndex(3)

        assert window.command_input.placeholderText() == "输入 Gemini prompt"
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


def test_main_window_renders_drained_events_as_screen_snapshot(tmp_path):
    app = QApplication.instance() or QApplication([])
    window = MainWindow(log_root=tmp_path)
    event = OutputEvent(
        run_id="hmi-powershell",
        stream=StreamName.PTY,
        raw="\x1b[32mold\x1b[0m\rnew",
        clean="old\rnew",
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
        run_id="hmi-powershell-screen-test",
    )
    try:
        window._drain_session()
        window._log_writer.close()

        run_dir = tmp_path / "hmi-powershell-screen-test"
        assert (run_dir / "raw.log").read_bytes() == "\x1b[32mold\x1b[0m\rnew".encode()
        assert (run_dir / "clean.log").read_bytes() == "old\rnew".encode()
        assert window.terminal.toPlainText() == "new"
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


def test_main_window_restores_last_workspace_from_settings(tmp_path):
    app = QApplication.instance() or QApplication([])
    store = SettingsStore(tmp_path / "settings.json")
    workspace = tmp_path / "remembered"
    workspace.mkdir()
    store.record_workspace(workspace)

    window = MainWindow(settings_store=store)
    try:
        assert window.workspace_path == workspace
        assert window.log_root == workspace / ".agenthub" / "runs"
    finally:
        window.close()
        app.processEvents()


def test_main_window_set_workspace_persists_recent_workspaces(tmp_path):
    app = QApplication.instance() or QApplication([])
    store = SettingsStore(tmp_path / "settings.json")
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    window = MainWindow(workspace_path=first, settings_store=store)
    try:
        window.set_workspace(second)

        settings = store.load()
        assert settings.last_workspace == second
        assert settings.recent_workspaces == (second,)
    finally:
        window.close()
        app.processEvents()


def test_main_window_lists_recent_workspaces_from_settings(tmp_path):
    app = QApplication.instance() or QApplication([])
    store = SettingsStore(tmp_path / "settings.json")
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    store.record_workspace(first)
    store.record_workspace(second)

    window = MainWindow(settings_store=store)
    try:
        items = [
            window.recent_workspace_combo.itemText(index)
            for index in range(window.recent_workspace_combo.count())
        ]

        assert items == [str(second), str(first)]
    finally:
        window.close()
        app.processEvents()


def test_main_window_indexes_started_and_stopped_sessions(tmp_path):
    app = QApplication.instance() or QApplication([])
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    window = MainWindow(workspace_path=workspace)

    class FakeSession:
        def __init__(self):
            self.alive = False
            self.writes = []

        def start(self):
            self.alive = True

        def write(self, text):
            self.writes.append(text)

        def drain(self):
            return []

        def is_alive(self):
            return self.alive

        def stop(self):
            self.alive = False

    fake_session = FakeSession()
    window._create_session = lambda profile, run_id=None: fake_session
    try:
        window.start_session()

        store = RunIndexStore.for_workspace(workspace)
        records = store.list_records()
        assert len(records) == 1
        assert records[0].profile_id == "powershell"
        assert records[0].profile_name == "PowerShell"
        assert records[0].workspace_path == workspace
        assert records[0].status == RunStatus.RUNNING
        assert records[0].ended_at is None

        window.stop_session()

        records = store.list_records()
        assert len(records) == 1
        assert records[0].status == RunStatus.STOPPED
        assert records[0].ended_at is not None
    finally:
        window.close()
        app.processEvents()


def test_main_window_marks_index_exited_when_session_process_ends(tmp_path):
    app = QApplication.instance() or QApplication([])
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    window = MainWindow(workspace_path=workspace)

    class FakeSession:
        def __init__(self):
            self.alive = False

        def start(self):
            self.alive = True

        def drain(self):
            return []

        def is_alive(self):
            return self.alive

        def stop(self):
            self.alive = False

    fake_session = FakeSession()
    window._create_session = lambda profile, run_id=None: fake_session
    try:
        window.start_session()
        fake_session.alive = False

        window._drain_session()

        records = RunIndexStore.for_workspace(workspace).list_records()
        assert len(records) == 1
        assert records[0].status == RunStatus.EXITED
        assert records[0].ended_at is not None
    finally:
        window.close()
        app.processEvents()


def test_main_window_indexes_start_failure(tmp_path):
    app = QApplication.instance() or QApplication([])
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    window = MainWindow(workspace_path=workspace)

    class FailingSession:
        def start(self):
            raise RuntimeError("boom")

        def stop(self):
            pass

    window._create_session = lambda profile, run_id=None: FailingSession()
    try:
        window.start_session()

        records = RunIndexStore.for_workspace(workspace).list_records()
        assert len(records) == 1
        assert records[0].status == RunStatus.START_FAILED
        assert records[0].ended_at is not None
        assert records[0].error_message == "boom"
        assert window._log_writer is None
        assert window._active_run_id is None
    finally:
        window.close()
        app.processEvents()


def test_main_window_refreshes_run_history_for_current_workspace(tmp_path):
    app = QApplication.instance() or QApplication([])
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _create_indexed_run(
        workspace,
        run_id="codex-run",
        profile_id="codex",
        profile_name="Codex",
        clean_text="clean output",
        raw_text="raw output",
    )

    window = MainWindow(workspace_path=workspace)
    try:
        window.refresh_run_history()

        assert window.history_list.count() == 1
        item = window.history_list.item(0)
        assert "Codex" in item.text()
        assert "exited" in item.text()
        assert item.data(Qt.ItemDataRole.UserRole).run_id == "codex-run"
    finally:
        window.close()
        app.processEvents()


def test_main_window_loads_selected_clean_and_raw_history_logs(tmp_path):
    app = QApplication.instance() or QApplication([])
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _create_indexed_run(
        workspace,
        run_id="powershell-run",
        profile_id="powershell",
        profile_name="PowerShell",
        clean_text="CLEAN LOG\n",
        raw_text="\x1b[32mRAW LOG\x1b[0m\n",
    )

    window = MainWindow(workspace_path=workspace)
    try:
        window.refresh_run_history()
        window.history_list.setCurrentRow(0)

        window.load_selected_clean_log()
        assert window.terminal.toPlainText() == "CLEAN LOG\n"

        window.load_selected_raw_log()
        assert window.terminal.toPlainText() == "\x1b[32mRAW LOG\x1b[0m\n"
    finally:
        window.close()
        app.processEvents()


def test_main_window_groups_tasks_by_status(tmp_path):
    app = QApplication.instance() or QApplication([])
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    store = TaskStore.for_workspace(workspace)
    pending = store.create_task(title="写规格", description="整理需求")
    running = store.create_task(title="实现 UI", description="")
    review = store.create_task(title="复查", description="检查行为")
    done = store.create_task(title="合并文档", description="")
    failed = store.create_task(title="失败任务", description="需要处理")
    store.update_status(running.id, TaskStatus.RUNNING)
    store.update_status(review.id, TaskStatus.REVIEW)
    store.update_status(done.id, TaskStatus.DONE)
    store.update_status(failed.id, TaskStatus.FAILED)

    window = MainWindow(workspace_path=workspace)
    try:
        assert _task_list_texts(window, TaskStatus.PENDING) == ["写规格\n整理需求"]
        assert _task_list_texts(window, TaskStatus.RUNNING) == ["实现 UI"]
        assert _task_list_texts(window, TaskStatus.REVIEW) == ["复查\n检查行为"]
        assert _task_list_texts(window, TaskStatus.DONE) == ["合并文档"]
        assert _task_list_texts(window, TaskStatus.FAILED) == ["失败任务\n需要处理"]
    finally:
        window.close()
        app.processEvents()


def test_main_window_refreshes_tasks_after_workspace_change(tmp_path):
    app = QApplication.instance() or QApplication([])
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    TaskStore.for_workspace(first).create_task(title="第一个 workspace", description="")
    TaskStore.for_workspace(second).create_task(title="第二个 workspace", description="")

    window = MainWindow(workspace_path=first)
    try:
        assert _task_list_texts(window, TaskStatus.PENDING) == ["第一个 workspace"]

        window.set_workspace(second)

        assert _task_list_texts(window, TaskStatus.PENDING) == ["第二个 workspace"]
    finally:
        window.close()
        app.processEvents()


def _create_indexed_run(
    workspace,
    *,
    run_id,
    profile_id,
    profile_name,
    clean_text,
    raw_text,
):
    run_dir = workspace / ".agenthub" / "runs" / run_id
    run_dir.mkdir(parents=True)
    raw_log_path = run_dir / "raw.log"
    clean_log_path = run_dir / "clean.log"
    raw_log_path.write_text(raw_text, encoding="utf-8")
    clean_log_path.write_text(clean_text, encoding="utf-8")

    paths = RunLogPaths(
        run_id=run_id,
        run_dir=run_dir,
        raw_log_path=raw_log_path,
        clean_log_path=clean_log_path,
    )
    return RunIndexStore.for_workspace(workspace).create_run(
        profile_id=profile_id,
        profile_name=profile_name,
        workspace_path=workspace,
        log_paths=paths,
        status=RunStatus.EXITED,
    )


def _task_list_texts(window, status):
    task_list = window.task_lists[status]
    return [task_list.item(index).text() for index in range(task_list.count())]
