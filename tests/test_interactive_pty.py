import platform
import time

import pytest

from agenthub.process.interactive_pty import InteractivePtySession


pytestmark = pytest.mark.skipif(
    platform.system() != "Windows",
    reason="ConPTY is Windows-only",
)


def test_interactive_pty_session_writes_and_drains_output():
    session = InteractivePtySession(
        run_id="interactive-1",
        command=["powershell.exe", "-NoLogo", "-NoProfile"],
    )
    try:
        session.start()
        session.write("echo AGENTHUB_INTERACTIVE_OK\r\n")

        deadline = time.monotonic() + 15
        text = ""
        while time.monotonic() < deadline and "AGENTHUB_INTERACTIVE_OK" not in text:
            text += "".join(event.clean for event in session.drain())
            time.sleep(0.05)

        assert "AGENTHUB_INTERACTIVE_OK" in text
    finally:
        session.write("exit\r\n")
        session.stop()
