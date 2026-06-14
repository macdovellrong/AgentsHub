import { describe, expect, it, vi } from "vitest";
import { createTerminalResizeScheduler } from "./terminal-resize-scheduler";

describe("createTerminalResizeScheduler", () => {
  it("coalesces resize requests into one animation frame", () => {
    const fitAndReport = vi.fn();
    const frameCallbacks: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    const cancelFrame = vi.fn();
    const scheduler = createTerminalResizeScheduler(fitAndReport, requestFrame, cancelFrame);

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();

    expect(requestFrame).toHaveBeenCalledOnce();

    frameCallbacks[0](100);

    expect(fitAndReport).toHaveBeenCalledOnce();
  });

  it("cancels pending resize work after disposal", () => {
    const fitAndReport = vi.fn();
    const frameCallbacks: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return 42;
    });
    const cancelFrame = vi.fn();
    const scheduler = createTerminalResizeScheduler(fitAndReport, requestFrame, cancelFrame);

    scheduler.schedule();
    scheduler.dispose();
    frameCallbacks[0](100);
    scheduler.schedule();

    expect(cancelFrame).toHaveBeenCalledWith(42);
    expect(fitAndReport).not.toHaveBeenCalled();
    expect(requestFrame).toHaveBeenCalledOnce();
  });
});
