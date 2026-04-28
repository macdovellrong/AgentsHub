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

  const nextSize = { cols: terminal.cols, rows: terminal.rows };

  if (lastReportedSize?.cols === nextSize.cols && lastReportedSize.rows === nextSize.rows) {
    return lastReportedSize;
  }

  onResize(nextSize.cols, nextSize.rows);
  return nextSize;
}
