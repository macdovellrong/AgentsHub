import { describe, expect, it } from "vitest";
import { resolveTerminalRendererMode } from "./terminal-renderer";

describe("resolveTerminalRendererMode", () => {
  it("uses canvas by default to avoid WebGL black screens when Electron GPU acceleration is disabled", () => {
    expect(resolveTerminalRendererMode(undefined)).toBe("canvas");
    expect(resolveTerminalRendererMode("")).toBe("canvas");
  });

  it("allows explicit WebGL opt-in", () => {
    expect(resolveTerminalRendererMode("webgl")).toBe("webgl");
  });
});
