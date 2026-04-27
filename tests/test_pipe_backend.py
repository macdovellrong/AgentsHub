import sys

from agenthub.process.base import BackendMode, StreamName
from agenthub.process.pipe_backend import PipeBackend


def test_pipe_backend_captures_stdout_stderr_and_exit_code():
    backend = PipeBackend()

    result = backend.run(
        run_id="pipe-1",
        command=[
            sys.executable,
            "-c",
            "import sys; print('OUT'); print('ERR', file=sys.stderr)",
        ],
        cwd=None,
        timeout_seconds=10,
    )

    assert result.backend_mode == BackendMode.PIPE
    assert result.exit_code == 0
    assert result.stdout == "OUT\n"
    assert result.stderr == "ERR\n"
    assert [event.stream for event in result.events] == [
        StreamName.STDOUT,
        StreamName.STDERR,
    ]
