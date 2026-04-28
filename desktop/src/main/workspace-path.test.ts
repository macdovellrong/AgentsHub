import { describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "./workspace-path";

describe("resolveWorkspacePath", () => {
  it("uses a non-empty requested workspace path", () => {
    expect(resolveWorkspacePath("C:\\work", "C:\\fallback")).toBe("C:\\work");
  });

  it("falls back when requested workspace path is blank", () => {
    expect(resolveWorkspacePath("   ", "C:\\fallback")).toBe("C:\\fallback");
  });
});
