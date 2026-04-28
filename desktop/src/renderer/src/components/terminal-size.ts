type TerminalSize = {
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
): void {
  if (!sessionId) {
    return;
  }

  fitAddon.fit();
  onResize(terminal.cols, terminal.rows);
}
