import { describe, expect, it } from "vitest";
import { createRawTerminalState } from "./raw-terminal-state";

describe("createRawTerminalState", () => {
  it("tracks size, output bytes, input bytes, and alternate buffer transitions", () => {
    const state = createRawTerminalState({ cols: 80, rows: 24 });
    const output = "\x1b[?1049hhello";

    state.recordOutput(output);
    state.recordInput("abc");
    state.resize(120, 40);

    expect(state.snapshot()).toMatchObject({
      cols: 120,
      rows: 40,
      outputBytes: Buffer.byteLength(output, "utf8"),
      inputBytes: 3,
      alternateBuffer: true,
    });
  });

  it("tracks alternate buffer exit sequences", () => {
    const state = createRawTerminalState({ cols: 80, rows: 24 });

    state.recordOutput("\x1b[?1049h");
    state.recordOutput("\x1b[?1049l");

    expect(state.snapshot().alternateBuffer).toBe(false);
  });

  it("ignores invalid resize dimensions", () => {
    const state = createRawTerminalState({ cols: 80, rows: 24 });

    state.resize(0, Number.NaN);

    expect(state.snapshot()).toMatchObject({ cols: 80, rows: 24 });
  });
});
