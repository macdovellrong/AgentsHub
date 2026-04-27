from agenthub.main import main


def test_main_pipe_smoke_returns_zero():
    assert main(["pipe-smoke"]) == 0
