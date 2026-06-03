import { describe, expect, it } from "vitest";
import { isTerminalSoftNewlineKey } from "./terminal-keyboard";

describe("isTerminalSoftNewlineKey", () => {
  it("handles only Shift+Enter keydown as a terminal soft newline", () => {
    expect(isTerminalSoftNewlineKey({ type: "keydown", key: "Enter", shiftKey: true })).toBe(true);
    expect(isTerminalSoftNewlineKey({ type: "keydown", key: "Enter", shiftKey: false })).toBe(false);
    expect(isTerminalSoftNewlineKey({ type: "keyup", key: "Enter", shiftKey: true })).toBe(false);
    expect(isTerminalSoftNewlineKey({ type: "keydown", key: "A", shiftKey: true })).toBe(false);
  });
});
