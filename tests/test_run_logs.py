from agenthub.process.base import OutputEvent, StreamName
from agenthub.storage.run_logs import RunLogWriter


def test_run_log_writer_creates_raw_and_clean_logs(tmp_path):
    writer = RunLogWriter.create(root=tmp_path, profile_id="powershell", run_id="run-1")
    event = OutputEvent(
        run_id="run-1",
        stream=StreamName.PTY,
        raw="\x1b[32mOK\x1b[0m\r\n",
        clean="OK\r\n",
    )

    writer.append(event)
    writer.close()

    assert writer.paths.run_dir == tmp_path / "run-1"
    assert writer.paths.raw_log_path.read_bytes() == "\x1b[32mOK\x1b[0m\r\n".encode()
    assert writer.paths.clean_log_path.read_bytes() == "OK\r\n".encode()


def test_run_log_writer_generates_profile_prefixed_run_id(tmp_path):
    writer = RunLogWriter.create(root=tmp_path, profile_id="codex")
    try:
        assert writer.paths.run_id.startswith("codex-")
        assert writer.paths.run_dir.exists()
    finally:
        writer.close()
