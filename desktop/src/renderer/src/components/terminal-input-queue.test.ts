import { describe, expect, it } from "vitest";
import { createTerminalInputQueue } from "./terminal-input-queue";

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

describe("createTerminalInputQueue", () => {
  it("serializes terminal input writes in call order", async () => {
    const calls: string[] = [];
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const sendQueuedTerminalInput = createTerminalInputQueue(async (request) => {
      calls.push(request.data);
      if (request.data === "A") {
        await firstWrite;
      }
    });

    sendQueuedTerminalInput({ sessionId: "session-1", data: "A", source: "user" });
    sendQueuedTerminalInput({ sessionId: "session-1", data: "\n", source: "user" });
    sendQueuedTerminalInput({ sessionId: "session-1", data: "B", source: "user" });

    await flushPromises();
    expect(calls).toEqual(["A"]);

    releaseFirst();
    await flushPromises();

    expect(calls).toEqual(["A", "\n", "B"]);
  });
});
