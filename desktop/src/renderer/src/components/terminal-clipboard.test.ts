import { describe, expect, it } from "vitest";
import { hasClipboardImage } from "./terminal-clipboard";

describe("terminal clipboard helpers", () => {
  it("detects image items in clipboard data", () => {
    expect(
      hasClipboardImage({
        items: [{ kind: "file", type: "image/png" }],
      }),
    ).toBe(true);
  });

  it("ignores text-only clipboard data", () => {
    expect(
      hasClipboardImage({
        items: [{ kind: "string", type: "text/plain" }],
      }),
    ).toBe(false);
  });

  it("falls back to clipboard files when items are unavailable", () => {
    expect(
      hasClipboardImage({
        files: [{ type: "image/jpeg" }],
      }),
    ).toBe(true);
  });
});
