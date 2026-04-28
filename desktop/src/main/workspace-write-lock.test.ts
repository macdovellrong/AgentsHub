import { describe, expect, it } from "vitest";
import { WorkspaceWriteLockService } from "./workspace-write-lock";

describe("WorkspaceWriteLockService", () => {
  it("tracks active write-capable sessions by workspace", () => {
    const locks = new WorkspaceWriteLockService();

    locks.register({
      sessionId: "session-1",
      workspacePath: "C:/work",
      profileId: "codex",
      profileName: "Codex",
      useWorkspaceWriteLock: true,
    });

    expect(locks.canStart("C:/work", true)).toEqual({
      ok: false,
      reason: "Workspace has active write-capable session: Codex",
    });
    expect(locks.canStart("C:/work", false)).toEqual({ ok: true });

    locks.release("session-1");
    expect(locks.canStart("C:/work", true)).toEqual({ ok: true });
  });

  it("reports whether any active write locks prevent workspace changes", () => {
    const locks = new WorkspaceWriteLockService();
    locks.register({
      sessionId: "session-1",
      workspacePath: "C:/work",
      profileId: "codex",
      profileName: "Codex",
      useWorkspaceWriteLock: true,
    });

    expect(locks.canChangeWorkspace()).toEqual({
      ok: false,
      reason: "Active write-capable sessions must stop before changing workspace.",
    });
  });
});
