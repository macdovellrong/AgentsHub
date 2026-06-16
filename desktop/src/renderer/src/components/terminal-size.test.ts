import { describe, expect, it, vi } from "vitest";
import { fitAndReportTerminalSize } from "./terminal-size";

describe("fitAndReportTerminalSize", () => {
  it("keeps the previous size when xterm dimension getters fail during resize", () => {
    const fitAddon = { fit: vi.fn() };
    const onResize = vi.fn();
    const lastReportedSize = { cols: 100, rows: 30 };
    const terminal = {
      get cols(): number {
        throw new TypeError("Cannot read properties of undefined (reading 'dimensions')");
      },
      get rows(): number {
        return 40;
      },
    };

    const result = fitAndReportTerminalSize("session-1", terminal, fitAddon, onResize, lastReportedSize);

    expect(result).toBe(lastReportedSize);
    expect(onResize).not.toHaveBeenCalled();
  });

  it("does not report unusable terminal dimensions", () => {
    const fitAddon = { fit: vi.fn() };
    const onResize = vi.fn();

    const result = fitAndReportTerminalSize("session-1", { cols: 0, rows: Number.NaN }, fitAddon, onResize);

    expect(result).toBeNull();
    expect(onResize).not.toHaveBeenCalled();
  });
});
