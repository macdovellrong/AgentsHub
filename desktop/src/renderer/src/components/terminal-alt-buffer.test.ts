import { describe, expect, it, vi } from "vitest";
import { createTerminalAltBufferTracker } from "./terminal-alt-buffer";

class FakeBuffer {
  readonly normal = {};
  readonly alternate = {};
  active = this.normal;
  private listeners: Array<() => void> = [];

  onBufferChange(callback: () => void): { dispose(): void } {
    this.listeners.push(callback);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((listener) => listener !== callback);
      },
    };
  }

  enterAlternate(): void {
    this.active = this.alternate;
    this.emit();
  }

  enterNormal(): void {
    this.active = this.normal;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

describe("createTerminalAltBufferTracker", () => {
  it("reports when the terminal is already in the alternate buffer", () => {
    const buffer = new FakeBuffer();
    const onEnter = vi.fn();
    buffer.enterAlternate();

    createTerminalAltBufferTracker({ buffer }, onEnter);

    expect(onEnter).toHaveBeenCalledOnce();
  });

  it("reports each transition into the alternate buffer once", () => {
    const buffer = new FakeBuffer();
    const onEnter = vi.fn();
    const tracker = createTerminalAltBufferTracker({ buffer }, onEnter);

    buffer.enterAlternate();
    buffer.enterAlternate();
    buffer.enterNormal();
    buffer.enterAlternate();
    tracker.dispose();
    buffer.enterNormal();
    buffer.enterAlternate();

    expect(onEnter).toHaveBeenCalledTimes(2);
  });
});
