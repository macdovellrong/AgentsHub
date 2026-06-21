export type RawTerminalStateSnapshot = {
  cols: number;
  rows: number;
  outputBytes: number;
  inputBytes: number;
  alternateBuffer: boolean;
  lastOutputAt: string | null;
};

export type RawTerminalState = {
  recordOutput(data: string): void;
  recordInput(data: string): void;
  resize(cols: number, rows: number): void;
  snapshot(): RawTerminalStateSnapshot;
};

const ENTER_ALTERNATE_BUFFER_PATTERNS = ["\x1b[?1049h", "\x1b[?1047h", "\x1b[?47h"];
const EXIT_ALTERNATE_BUFFER_PATTERNS = ["\x1b[?1049l", "\x1b[?1047l", "\x1b[?47l"];

export function createRawTerminalState(input: { cols: number; rows: number }): RawTerminalState {
  let cols = normalizeDimension(input.cols, 80);
  let rows = normalizeDimension(input.rows, 24);
  let outputBytes = 0;
  let inputBytes = 0;
  let alternateBuffer = false;
  let lastOutputAt: string | null = null;

  return {
    recordOutput(data: string): void {
      outputBytes += Buffer.byteLength(data, "utf8");
      lastOutputAt = new Date().toISOString();
      if (containsAny(data, ENTER_ALTERNATE_BUFFER_PATTERNS)) {
        alternateBuffer = true;
      }
      if (containsAny(data, EXIT_ALTERNATE_BUFFER_PATTERNS)) {
        alternateBuffer = false;
      }
    },
    recordInput(data: string): void {
      inputBytes += Buffer.byteLength(data, "utf8");
    },
    resize(nextCols: number, nextRows: number): void {
      if (!isValidDimension(nextCols) || !isValidDimension(nextRows)) {
        return;
      }
      cols = nextCols;
      rows = nextRows;
    },
    snapshot(): RawTerminalStateSnapshot {
      return {
        cols,
        rows,
        outputBytes,
        inputBytes,
        alternateBuffer,
        lastOutputAt,
      };
    },
  };
}

function containsAny(data: string, patterns: string[]): boolean {
  return patterns.some((pattern) => data.includes(pattern));
}

function normalizeDimension(value: number, fallback: number): number {
  return isValidDimension(value) ? value : fallback;
}

function isValidDimension(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
