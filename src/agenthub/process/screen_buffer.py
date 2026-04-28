from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class TerminalScreenBuffer:
    max_lines: int = 1_000
    _lines: list[list[str]] = field(default_factory=lambda: [[]])
    _row: int = 0
    _col: int = 0
    _clear_line_on_write: bool = False

    def feed(self, text: str) -> None:
        index = 0
        while index < len(text):
            char = text[index]
            if char == "\x1b":
                index = self._consume_escape(text, index)
                continue
            if char == "\r":
                self._col = 0
                self._clear_line_on_write = True
            elif char == "\n":
                self._clear_line_on_write = False
                self._newline()
            elif char == "\b":
                self._col = max(0, self._col - 1)
            elif char >= " " or char == "\t":
                self._put_char(char)
            index += 1

    def snapshot(self) -> str:
        rendered = ["".join(line).rstrip() for line in self._lines]
        while rendered and rendered[-1] == "":
            rendered.pop()
        return "\n".join(rendered)

    def clear(self) -> None:
        self._lines = [[]]
        self._row = 0
        self._col = 0
        self._clear_line_on_write = False

    def _put_char(self, char: str) -> None:
        line = self._lines[self._row]
        if self._clear_line_on_write:
            line.clear()
            self._clear_line_on_write = False
        while len(line) < self._col:
            line.append(" ")
        if self._col == len(line):
            line.append(char)
        else:
            line[self._col] = char
        self._col += 1

    def _newline(self) -> None:
        self._row += 1
        self._col = 0
        while len(self._lines) <= self._row:
            self._lines.append([])
        self._trim_to_height()

    def _trim_to_height(self) -> None:
        if self.max_lines <= 0:
            self.clear()
            return
        extra = len(self._lines) - self.max_lines
        if extra <= 0:
            return
        del self._lines[:extra]
        self._row = max(0, self._row - extra)

    def _consume_escape(self, text: str, start: int) -> int:
        if start + 1 >= len(text):
            return start
        marker = text[start + 1]
        if marker != "[":
            return min(start + 1, len(text) - 1)

        end = start + 2
        while end < len(text):
            final = text[end]
            if "@" <= final <= "~":
                self._handle_csi(text[start + 2 : end], final)
                return end + 1
            end += 1
        return len(text)

    def _handle_csi(self, params: str, final: str) -> None:
        values = _parse_csi_params(params)
        if final == "J" and _first_value(values, default=0) == 2:
            self.clear()
        elif final in ("H", "f"):
            row = max(1, values[0] if len(values) >= 1 and values[0] is not None else 1)
            col = max(1, values[1] if len(values) >= 2 and values[1] is not None else 1)
            self._move_cursor(row - 1, col - 1)
        elif final == "K":
            mode = _first_value(values, default=0)
            if mode in (0, 2):
                self._clear_line_from_cursor()
        elif final == "G":
            col = max(1, _first_value(values, default=1))
            self._col = col - 1

    def _move_cursor(self, row: int, col: int) -> None:
        self._row = row
        self._col = col
        while len(self._lines) <= self._row:
            self._lines.append([])
        self._trim_to_height()

    def _clear_line_from_cursor(self) -> None:
        line = self._lines[self._row]
        del line[self._col :]


def _parse_csi_params(params: str) -> list[int | None]:
    if not params:
        return []
    if params.startswith("?"):
        params = params[1:]
    values: list[int | None] = []
    for part in params.split(";"):
        if not part:
            values.append(None)
            continue
        try:
            values.append(int(part))
        except ValueError:
            values.append(None)
    return values


def _first_value(values: list[int | None], *, default: int) -> int:
    if not values or values[0] is None:
        return default
    return values[0]
