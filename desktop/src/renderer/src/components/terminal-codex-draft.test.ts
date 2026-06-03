import { describe, expect, it } from "vitest";
import { createCodexTerminalDraftTracker } from "./terminal-codex-draft";

const bracketedPaste = (text: string): string => `\x1b[200~${text}\x1b[201~`;

describe("createCodexTerminalDraftTracker", () => {
  it("rewrites the current Codex draft as a complete bracketed paste with a trailing newline", () => {
    const draft = createCodexTerminalDraftTracker();

    draft.recordUserInput("AAA");

    const input = draft.createSoftNewlineInput();

    expect(input).toBe("\x7f\x7f\x7f" + bracketedPaste("AAA\n"));
    expect(input?.endsWith("\n")).toBe(false);
    expect(draft.currentText()).toBe("AAA\n");
  });

  it("rewrites multi-line drafts on subsequent soft newlines", () => {
    const draft = createCodexTerminalDraftTracker();

    draft.recordUserInput("AAA");
    draft.createSoftNewlineInput();
    draft.recordUserInput("BBB");

    expect(draft.createSoftNewlineInput()).toBe("\x7f".repeat(7) + bracketedPaste("AAA\nBBB\n"));
    expect(draft.currentText()).toBe("AAA\nBBB\n");
  });

  it("tracks backspace and resets after a submitted prompt", () => {
    const draft = createCodexTerminalDraftTracker();

    draft.recordUserInput("ABC");
    draft.recordUserInput("\x7f");
    expect(draft.currentText()).toBe("AB");

    draft.recordUserInput("\r");
    expect(draft.currentText()).toBe("");
  });

  it("ignores focus notifications but refuses to rewrite after unsupported control input", () => {
    const draft = createCodexTerminalDraftTracker();

    draft.recordUserInput("\x1b[I");
    draft.recordUserInput("ABC");
    draft.recordUserInput("\x1b[2D");

    expect(draft.createSoftNewlineInput()).toBeNull();
    expect(draft.currentText()).toBe("ABC");
  });
});
