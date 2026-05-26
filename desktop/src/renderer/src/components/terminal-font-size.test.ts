import { describe, expect, it } from "vitest";
import { DEFAULT_TERMINAL_FONT_SIZE, resolveTerminalFontSize } from "./terminal-font-size";

describe("resolveTerminalFontSize", () => {
  it("increases terminal font size with Ctrl+plus shortcuts", () => {
    expect(resolveTerminalFontSize(13, { ctrlKey: true, key: "=" })).toBe(14);
    expect(resolveTerminalFontSize(13, { ctrlKey: true, key: "+" })).toBe(14);
  });

  it("decreases terminal font size with Ctrl+minus", () => {
    expect(resolveTerminalFontSize(13, { ctrlKey: true, key: "-" })).toBe(12);
  });

  it("resets terminal font size with Ctrl+0", () => {
    expect(resolveTerminalFontSize(18, { ctrlKey: true, key: "0" })).toBe(DEFAULT_TERMINAL_FONT_SIZE);
  });

  it("ignores unrelated key events", () => {
    expect(resolveTerminalFontSize(13, { ctrlKey: false, key: "=" })).toBe(13);
    expect(resolveTerminalFontSize(13, { ctrlKey: true, key: "a" })).toBe(13);
  });

  it("clamps terminal font size to a readable range", () => {
    expect(resolveTerminalFontSize(22, { ctrlKey: true, key: "=" })).toBe(22);
    expect(resolveTerminalFontSize(10, { ctrlKey: true, key: "-" })).toBe(10);
  });
});
