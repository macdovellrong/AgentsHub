import { describe, expect, it } from "vitest";
import { createTerminalCompositionState } from "./terminal-composition";

describe("createTerminalCompositionState", () => {
  it("reads pending IME text from composition updates and textarea changes", () => {
    const composition = createTerminalCompositionState();
    const pendingChineseText = "\u4e2d\u6587";

    composition.start("AAA");
    composition.update(pendingChineseText, `AAA${pendingChineseText}`);

    expect(composition.pendingText(`AAA${pendingChineseText}`)).toBe(pendingChineseText);
  });

  it("clears pending IME text from the textarea after it is sent manually", () => {
    const composition = createTerminalCompositionState();
    const pendingChineseText = "\u4e2d\u6587";
    const textarea = { value: `AAA${pendingChineseText}` };

    composition.start("AAA");
    composition.update(pendingChineseText, textarea.value);
    composition.clear(textarea);

    expect(textarea.value).toBe("AAA");
    expect(composition.pendingText(textarea.value)).toBe("");
  });
});
