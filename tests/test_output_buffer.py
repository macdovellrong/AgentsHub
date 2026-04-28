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


def test_output_buffer_exposes_screen_snapshot_from_raw_terminal_stream():
    buffer = OutputBuffer(max_lines=10)
    buffer.append(
        OutputEvent(
            "run-1",
            StreamName.PTY,
            "\x1b[32mold\x1b[0m\rnew",
            "old\rnew",
        )
    )

    assert buffer.has_pending_snapshot()
    assert buffer.snapshot() == "new"
    assert not buffer.has_pending_snapshot()


def test_output_buffer_does_not_duplicate_plain_event_text_in_snapshot():
    buffer = OutputBuffer(max_lines=10)

    buffer.append(OutputEvent("run-1", StreamName.PTY, "ABC", "ABC"))

    assert buffer.snapshot() == "ABC"
