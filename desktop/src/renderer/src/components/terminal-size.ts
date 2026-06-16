export type TerminalSize = {
  cols: number;
  rows: number;
};

type FitAddonLike = {
  fit(): void;
};

export function fitAndReportTerminalSize(
  sessionId: string | null,
  terminal: TerminalSize,
  fitAddon: FitAddonLike,
  onResize: (cols: number, rows: number) => void,
  lastReportedSize: TerminalSize | null = null,
): TerminalSize | null {
  if (!sessionId) {
    return lastReportedSize;
  }

  try {
    fitAddon.fit();
  } catch {
    return lastReportedSize;
  }

  const nextSize = readTerminalSize(terminal);

  if (!nextSize) {
    return lastReportedSize;
  }

  if (lastReportedSize?.cols === nextSize.cols && lastReportedSize.rows === nextSize.rows) {
    return lastReportedSize;
  }

  onResize(nextSize.cols, nextSize.rows);
  return nextSize;
}

function readTerminalSize(terminal: TerminalSize): TerminalSize | null {
  try {
    const nextSize = { cols: terminal.cols, rows: terminal.rows };
    if (!Number.isFinite(nextSize.cols) || !Number.isFinite(nextSize.rows) || nextSize.cols < 1 || nextSize.rows < 1) {
      return null;
    }
    return nextSize;
  } catch {
    return null;
  }
}
