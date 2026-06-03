import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const componentsRoot = __dirname;

describe("TerminalPane keyboard integration", () => {
  it("uses a custom key handler for Shift+Enter soft newlines", () => {
    const source = readFileSync(join(componentsRoot, "TerminalPane.tsx"), "utf8");

    expect(source).toContain("terminal.attachCustomKeyEventHandler");
    expect(source).toContain("isTerminalSoftNewlineKey");
    expect(source).toContain("sendTerminalSoftNewline");
    expect(source).not.toContain("terminal.paste");
  });
});
