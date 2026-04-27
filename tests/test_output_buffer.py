from agenthub.process.base import OutputEvent, StreamName
from agenthub.ui.output_buffer import OutputBuffer


def test_output_buffer_flushes_clean_text_in_order():
    buffer = OutputBuffer()
    buffer.append(OutputEvent("run-1", StreamName.PTY, "raw-1", "A"))
    buffer.append(OutputEvent("run-1", StreamName.PTY, "raw-2", "B"))

    assert buffer.flush_text() == "AB"
    assert buffer.flush_text() == ""


def test_output_buffer_keeps_tail_when_limit_is_set():
    buffer = OutputBuffer(max_chars=5)
    buffer.append_text("123")
    buffer.append_text("4567")

    assert buffer.flush_text() == "34567"
