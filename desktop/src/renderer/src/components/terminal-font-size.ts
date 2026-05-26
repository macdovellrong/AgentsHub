export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const MIN_TERMINAL_FONT_SIZE = 10;
export const MAX_TERMINAL_FONT_SIZE = 22;

type TerminalFontSizeKeyEvent = {
  ctrlKey: boolean;
  key: string;
};

function clampTerminalFontSize(fontSize: number): number {
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, fontSize));
}

export function resolveTerminalFontSize(currentFontSize: number, event: TerminalFontSizeKeyEvent): number {
  if (!event.ctrlKey) {
    return currentFontSize;
  }

  if (event.key === "=" || event.key === "+") {
    return clampTerminalFontSize(currentFontSize + 1);
  }

  if (event.key === "-") {
    return clampTerminalFontSize(currentFontSize - 1);
  }

  if (event.key === "0") {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }

  return currentFontSize;
}
