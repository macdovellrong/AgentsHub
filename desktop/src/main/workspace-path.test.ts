import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getDefaultWorkspacePath, resolveWorkspacePath } from "./workspace-path";

describe("resolveWorkspacePath", () => {
  it("uses a non-empty requested workspace path", () => {
    expect(resolveWorkspacePath("C:\\work", "C:\\fallback")).toBe("C:\\work");
  });

  it("trims requested workspace path before using it", () => {
    expect(resolveWorkspacePath("  C:\\work  ", "C:\\fallback")).toBe("C:\\work");
  });

  it("falls back when requested workspace path is blank", () => {
    expect(resolveWorkspacePath("   ", "C:\\fallback")).toBe("C:\\fallback");
  });

  it("uses configured workspace before inferring a fallback", () => {
    expect(getDefaultWorkspacePath("C:\\repo\\desktop", " C:\\work ")).toBe("C:\\work");
  });

  it("infers the repository root when launched from the desktop package", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "agenthub-workspace-"));
    const desktopPath = path.join(repoRoot, "desktop");
    await writeFile(path.join(repoRoot, "AGENTS.md"), "# test\n", "utf8");

    try {
      expect(getDefaultWorkspacePath(desktopPath)).toBe(repoRoot);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
