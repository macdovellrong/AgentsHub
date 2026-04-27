from agenthub.process.base import OutputEvent, StreamName
from agenthub.process.output import normalize_chunk, strip_ansi


def test_strip_ansi_removes_color_sequences():
    assert strip_ansi("\x1b[32mOK\x1b[0m") == "OK"


def test_normalize_chunk_keeps_raw_and_clean_text():
    event = normalize_chunk("run-1", StreamName.STDOUT, "\x1b[31mERR\x1b[0m")

    assert isinstance(event, OutputEvent)
    assert event.run_id == "run-1"
    assert event.stream == StreamName.STDOUT
    assert event.raw == "\x1b[31mERR\x1b[0m"
    assert event.clean == "ERR"
