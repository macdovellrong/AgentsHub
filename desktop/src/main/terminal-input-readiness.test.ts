import { describe, expect, it } from "vitest";
import { shouldBufferTerminalInput, type TerminalInputSource } from "./terminal-input-readiness";

describe("shouldBufferTerminalInput", () => {
  it("buffers programmatic input until the terminal is ready", () => {
    expect(shouldBufferTerminalInput({ inputReady: false, source: "program" })).toBe(true);
    expect(shouldBufferTerminalInput({ inputReady: false, source: undefined })).toBe(true);
  });

  it("does not buffer user input or ready sessions", () => {
    expect(shouldBufferTerminalInput({ inputReady: false, source: "user" satisfies TerminalInputSource })).toBe(false);
    expect(shouldBufferTerminalInput({ inputReady: true, source: "program" })).toBe(false);
  });
});
