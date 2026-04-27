import platform

import pytest

from agenthub.process.base import BackendMode, StreamName
from agenthub.process.pty_backend import PtyBackend


pytestmark = pytest.mark.skipif(
    platform.system() != "Windows",
    reason="ConPTY is Windows-only",
)


def test_pty_backend_runs_powershell_echo():
    backend = PtyBackend(cols=120, rows=40)

    result = backend.run_once(
        run_id="pty-1",
        command=["powershell.exe", "-NoLogo", "-NoProfile"],
        input_text="echo AGENTHUB_PTY_OK\r\nexit\r\n",
        cwd=None,
        timeout_seconds=15,
    )

    assert result.backend_mode == BackendMode.PTY
    assert result.exit_code == 0
    assert any(event.stream == StreamName.PTY for event in result.events)
    assert "AGENTHUB_PTY_OK" in result.stdout
