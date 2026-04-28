from __future__ import annotations

import re

from agenthub.process.base import OutputEvent, StreamName

OSC_RE = re.compile(r"\x1b\].*?(?:\x07|\x1b\\)")
ANSI_RE = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|[@-Z\\-_]|[0-9]|[()][ -~])")


def strip_ansi(text: str) -> str:
    return ANSI_RE.sub("", OSC_RE.sub("", text))


def normalize_chunk(run_id: str, stream: StreamName, chunk: str) -> OutputEvent:
    return OutputEvent(run_id=run_id, stream=stream, raw=chunk, clean=strip_ansi(chunk))
