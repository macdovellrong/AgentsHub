import { describe, expect, it } from "vitest";
import {
  TERMINAL_SOFT_NEWLINE_INPUT,
  isTerminalSoftNewlineKey,
  sendTerminalSoftNewline,
} from "./terminal-keyboard";

describe("isTerminalSoftNewlineKey", () => {
  it("handles only Shift+Enter keydown as a terminal soft newline", () => {
    expect(isTerminalSoftNewlineKey({ type: "keydown", key: "Enter", shiftKey: true })).toBe(true);
    expect(isTerminalSoftNewlineKey({ type: "keydown", key: "Enter", shiftKey: false })).toBe(false);
    expect(isTerminalSoftNewlineKey({ type: "keyup", key: "Enter", shiftKey: true })).toBe(false);
    expect(isTerminalSoftNewlineKey({ type: "keydown", key: "A", shiftKey: true })).toBe(false);
  });

  it("sends a raw LF instead of xterm paste-normalized CR", async () => {
    const requests: unknown[] = [];
    const sent = await sendTerminalSoftNewline("session-1", async (request) => {
      requests.push(request);
    });

    expect(sent).toBe(true);
    expect(TERMINAL_SOFT_NEWLINE_INPUT).toBe("\n");
    expect(requests).toEqual([
      {
        sessionId: "session-1",
        data: "\n",
        source: "user",
      },
    ]);
  });

  it("does not send anything when no terminal session is active", async () => {
    const requests: unknown[] = [];
    const sent = await sendTerminalSoftNewline(null, async (request) => {
      requests.push(request);
    });

    expect(sent).toBe(false);
    expect(requests).toEqual([]);
  });
});
