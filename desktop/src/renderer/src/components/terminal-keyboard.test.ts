import { describe, expect, it } from "vitest";
import { createCodexTerminalDraftTracker } from "./terminal-codex-draft";
import {
  TERMINAL_SHIFT_ENTER_SEQUENCE,
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

  it("rewrites the tracked Codex draft as a complete paste on Shift+Enter", async () => {
    const requests: unknown[] = [];
    const draft = createCodexTerminalDraftTracker();

    draft.recordUserInput("AAA");
    const sent = await sendTerminalSoftNewline(
      "session-1",
      "codex",
      async (request) => {
        requests.push(request);
      },
      draft,
    );

    expect(sent).toBe(true);
    expect(requests).toEqual([
      {
        sessionId: "session-1",
        data: "\x7f\x7f\x7f\x1b[200~AAA\n\x1b[201~",
        source: "user",
      },
    ]);
    expect(draft.currentText()).toBe("AAA\n");
  });

  it("falls back to CSI-u for Codex when the draft is not synchronized", async () => {
    const requests: unknown[] = [];
    const draft = createCodexTerminalDraftTracker();

    draft.recordUserInput("AAA");
    draft.recordUserInput("\x1b[2D");
    const sent = await sendTerminalSoftNewline(
      "session-1",
      "codex",
      async (request) => {
        requests.push(request);
      },
      draft,
    );

    expect(sent).toBe(true);
    expect(TERMINAL_SHIFT_ENTER_SEQUENCE).toBe("\x1b[13;2u");
    expect(requests).toEqual([
      {
        sessionId: "session-1",
        data: "\x1b[13;2u",
        source: "user",
      },
    ]);
  });

  it("sends a normal LF soft newline for Claude and Gemini", async () => {
    const requests: unknown[] = [];

    const sentClaude = await sendTerminalSoftNewline("claude-session", "claude", async (request) => {
      requests.push(request);
    });
    const sentGemini = await sendTerminalSoftNewline("gemini-session", "gemini", async (request) => {
      requests.push(request);
    });

    expect(sentClaude).toBe(true);
    expect(sentGemini).toBe(true);
    expect(requests).toEqual([
      {
        sessionId: "claude-session",
        data: "\n",
        source: "user",
      },
      {
        sessionId: "gemini-session",
        data: "\n",
        source: "user",
      },
    ]);
  });

  it("does not send anything when no terminal session is active", async () => {
    const requests: unknown[] = [];
    const sent = await sendTerminalSoftNewline(null, "codex", async (request) => {
      requests.push(request);
    });

    expect(sent).toBe(false);
    expect(requests).toEqual([]);
  });
});
