from __future__ import annotations

import re

from agenthub.process.base import OutputEvent, StreamName

ANSI_RE = re.compile(r"\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")


def strip_ansi(text: str) -> str:
    return ANSI_RE.sub("", text)


def normalize_chunk(run_id: str, stream: StreamName, chunk: str) -> OutputEvent:
    return OutputEvent(run_id=run_id, stream=stream, raw=chunk, clean=strip_ansi(chunk))
