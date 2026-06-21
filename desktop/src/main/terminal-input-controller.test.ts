import { afterEach, describe, expect, it, vi } from "vitest";
import { createTerminalInputController, INPUT_READY_FIRST_OUTPUT_DELAY_MS, INPUT_READY_TIMEOUT_MS } from "./terminal-input-controller";

describe("createTerminalInputController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes user input directly and transforms programmatic multiline input for managed agents", () => {
    const writes: string[] = [];
    const controller = createTerminalInputController({
      kind: "codex",
      write: (data) => writes.push(data),
    });

    controller.markReady();
    controller.write("\x1b\r", "user");
    controller.write("line 1\nline 2\r\n", "program");

    expect(writes).toEqual(["\x1b\r", "\x1b[200~line 1\nline 2\x1b[201~"]);
    controller.dispose();
  });

  it("buffers programmatic input until first output settles", async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const controller = createTerminalInputController({
      kind: "powershell",
      write: (data) => writes.push(data),
    });

    controller.write("dir\r\n", "program");
    expect(writes).toEqual([]);

    controller.handleOutput();
    await vi.advanceTimersByTimeAsync(INPUT_READY_FIRST_OUTPUT_DELAY_MS);

    expect(writes).toEqual(["dir"]);
    await vi.advanceTimersByTimeAsync(25);
    expect(writes).toEqual(["dir", "\r"]);
    controller.dispose();
  });

  it("flushes buffered programmatic input after the ready timeout", async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const controller = createTerminalInputController({
      kind: "powershell",
      write: (data) => writes.push(data),
    });

    controller.write("dir\r\n", "program");
    await vi.advanceTimersByTimeAsync(INPUT_READY_TIMEOUT_MS);

    expect(writes).toEqual(["dir"]);
    controller.dispose();
  });
});
