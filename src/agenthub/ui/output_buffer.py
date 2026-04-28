from __future__ import annotations

from agenthub.process.base import OutputEvent
from agenthub.process.screen_buffer import TerminalScreenBuffer


class OutputBuffer:
    def __init__(
        self,
        max_chars: int | None = None,
        max_lines: int = 1_000,
    ) -> None:
        self.max_chars = max_chars
        self._pending: list[str] = []
        self._screen = TerminalScreenBuffer(max_lines=max_lines)
        self._snapshot_pending = False

    def append(self, event: OutputEvent) -> None:
        self._append_pending(event.clean)
        self._screen.feed(event.raw)
        self._snapshot_pending = True

    def append_text(self, text: str) -> None:
        if not text:
            return
        self._append_pending(text)
        self._screen.feed(text)
        self._snapshot_pending = True

    def _append_pending(self, text: str) -> None:
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

    def has_pending_snapshot(self) -> bool:
        return self._snapshot_pending

    def snapshot(self) -> str:
        self._snapshot_pending = False
        return self._screen.snapshot()

    def reset(self) -> None:
        self._pending.clear()
        self._screen.clear()
        self._snapshot_pending = False
