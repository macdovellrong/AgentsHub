import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TeamStore } from "./team-store";

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("TeamStore", () => {
  it("creates a default team config and appends mailbox records", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-team-store-"));
    const store = new TeamStore();

    const team = await store.ensureTeam(workspacePath, {
      id: "default",
      name: "Default Team",
      memberProfileIds: ["claude", "codex", "gemini"],
    });
    const message = await store.appendMailbox(workspacePath, {
      teamId: team.id,
      action: "send_message",
      fromProfileId: "claude",
      toProfileId: "codex",
      message: "Implement task A.",
      taskId: "T-001",
      status: "sent",
      sessionId: "codex-session",
    });

    await expect(store.getTeam(workspacePath, "default")).resolves.toMatchObject({
      id: "default",
      name: "Default Team",
      memberProfileIds: ["claude", "codex", "gemini"],
    });
    await expect(store.listMailbox(workspacePath, "default")).resolves.toMatchObject([
      {
        id: message.id,
        teamId: "default",
        action: "send_message",
        fromProfileId: "claude",
        toProfileId: "codex",
        taskId: "T-001",
        status: "sent",
        sessionId: "codex-session",
      },
    ]);
  });
});
