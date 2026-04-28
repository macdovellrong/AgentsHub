import path from "node:path";

export type LockRegistration = {
  sessionId: string;
  workspacePath: string;
  profileId: string;
  profileName: string;
  useWorkspaceWriteLock: boolean;
};

export type LockDecision = { ok: true } | { ok: false; reason: string };

export class WorkspaceWriteLockService {
  private readonly active = new Map<string, LockRegistration>();

  canStart(workspacePath: string, useWorkspaceWriteLock: boolean): LockDecision {
    if (!useWorkspaceWriteLock) {
      return { ok: true };
    }
    const normalized = this.normalizePath(workspacePath);
    const conflict = [...this.active.values()].find(
      (lock) => lock.useWorkspaceWriteLock && this.normalizePath(lock.workspacePath) === normalized,
    );
    if (!conflict) {
      return { ok: true };
    }
    return { ok: false, reason: `Workspace has active write-capable session: ${conflict.profileName}` };
  }

  register(lock: LockRegistration): void {
    if (lock.useWorkspaceWriteLock) {
      this.active.set(lock.sessionId, lock);
    }
  }

  release(sessionId: string): void {
    this.active.delete(sessionId);
  }

  canChangeWorkspace(): LockDecision {
    if (this.active.size === 0) {
      return { ok: true };
    }
    return { ok: false, reason: "Active write-capable sessions must stop before changing workspace." };
  }

  listActive(): LockRegistration[] {
    return [...this.active.values()];
  }

  private normalizePath(workspacePath: string): string {
    return path.resolve(workspacePath).toLowerCase();
  }
}
