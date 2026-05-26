import { describe, expect, it, vi } from "vitest";
import { createTerminalOutputAckBatcher } from "./terminal-output-ack";

describe("createTerminalOutputAckBatcher", () => {
  it("flushes ACK when the byte threshold is reached", () => {
    const sendAck = vi.fn();
    const batcher = createTerminalOutputAckBatcher({
      sendAck,
      batchBytes: 6,
      flushMs: 50,
    });

    batcher.ackWrittenData("session-1", "中文");

    expect(sendAck).toHaveBeenCalledWith({ sessionId: "session-1", byteLength: 6 });
  });

  it("flushes pending ACK bytes on a timer", () => {
    vi.useFakeTimers();
    const sendAck = vi.fn();
    const batcher = createTerminalOutputAckBatcher({
      sendAck,
      batchBytes: 5000,
      flushMs: 50,
    });

    batcher.ackWrittenData("session-1", "ready");
    expect(sendAck).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);

    expect(sendAck).toHaveBeenCalledWith({ sessionId: "session-1", byteLength: 5 });
    vi.useRealTimers();
  });

  it("does not throw when ACK delivery fails", () => {
    const batcher = createTerminalOutputAckBatcher({
      sendAck: () => {
        throw new Error("preload missing terminalAck");
      },
      batchBytes: 1,
      flushMs: 50,
    });

    expect(() => batcher.ackWrittenData("session-1", "ready")).not.toThrow();
  });
});
