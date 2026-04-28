from agenthub.process.screen_buffer import TerminalScreenBuffer


def test_screen_buffer_removes_ansi_color_sequences():
    screen = TerminalScreenBuffer()

    screen.feed("\x1b[32mOK\x1b[0m")

    assert screen.snapshot() == "OK"


def test_screen_buffer_carriage_return_overwrites_same_line():
    screen = TerminalScreenBuffer()

    screen.feed("progress 10%\rprogress 90%")

    assert screen.snapshot() == "progress 90%"


def test_screen_buffer_clear_screen_and_home_replace_visible_content():
    screen = TerminalScreenBuffer()

    screen.feed("old line\nsecond line\x1b[2J\x1b[Hnew")

    assert screen.snapshot() == "new"


def test_screen_buffer_accumulates_plain_newlines():
    screen = TerminalScreenBuffer()

    screen.feed("one\ntwo\nthree")

    assert screen.snapshot() == "one\ntwo\nthree"


def test_screen_buffer_limits_height_to_recent_lines():
    screen = TerminalScreenBuffer(max_lines=2)

    screen.feed("one\ntwo\nthree")

    assert screen.snapshot() == "two\nthree"
