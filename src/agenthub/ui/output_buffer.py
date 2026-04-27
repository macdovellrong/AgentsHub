from __future__ import annotations

from agenthub.process.base import OutputEvent


class OutputBuffer:
    def __init__(self, max_chars: int | None = None) -> None:
        self.max_chars = max_chars
        self._pending: list[str] = []

    def append(self, event: OutputEvent) -> None:
        self.append_text(event.clean)

    def append_text(self, text: str) -> None:
        if not text:
            return
        self._pending.append(text)
        if self.max_chars is not None:
            joined = "".join(self._pending)
            self._pending = [joined[-self.max_chars :]]

    def flush_text(self) -> str:
        if not self._pending:
            return ""
        text = "".join(self._pending)
        self._pending.clear()
        return text
