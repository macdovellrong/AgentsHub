import { describe, expect, it, vi } from "vitest";
import { fitAndReportTerminalSize } from "./terminal-size";

describe("fitAndReportTerminalSize", () => {
  it("fits and reports the terminal size for an active session", () => {
    const fit = vi.fn(() => {
      terminal.cols = 132;
      terminal.rows = 41;
    });
    const onResize = vi.fn();
    const terminal = { cols: 120, rows: 36 };

    fitAndReportTerminalSize("session-1", terminal, { fit }, onResize);

    expect(fit).toHaveBeenCalledOnce();
    expect(onResize).toHaveBeenCalledWith(132, 41);
  });

  it("does not fit or report without an active session", () => {
    const fit = vi.fn();
    const onResize = vi.fn();

    fitAndReportTerminalSize(null, { cols: 120, rows: 36 }, { fit }, onResize);

    expect(fit).not.toHaveBeenCalled();
    expect(onResize).not.toHaveBeenCalled();
  });

  it("does not report a resize when xterm cannot fit yet", () => {
    const fit = vi.fn(() => {
      throw new Error("renderer is not ready");
    });
    const onResize = vi.fn();

    expect(() => fitAndReportTerminalSize("session-1", { cols: 120, rows: 36 }, { fit }, onResize)).not.toThrow();
    expect(onResize).not.toHaveBeenCalled();
  });

  it("does not report unchanged terminal dimensions", () => {
    const fit = vi.fn();
    const onResize = vi.fn();

    const reportedSize = fitAndReportTerminalSize(
      "session-1",
      { cols: 120, rows: 36 },
      { fit },
      onResize,
      { cols: 120, rows: 36 },
    );

    expect(reportedSize).toEqual({ cols: 120, rows: 36 });
    expect(onResize).not.toHaveBeenCalled();
  });
});
