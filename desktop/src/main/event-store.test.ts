import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventStore } from "./event-store";

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("EventStore", () => {
  it("appends and lists workspace events in order", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-events-"));
    const store = new EventStore();

    const first = await store.append(workspacePath, {
      type: "user_message",
      message: "Build backend",
      targetProfileId: "codex",
    });
    const second = await store.append(workspacePath, {
      type: "session_started",
      sessionId: "session-1",
      runId: "run-1",
      profileId: "codex",
      profileName: "Codex",
    });

    await expect(store.list(workspacePath)).resolves.toMatchObject([
      { id: first.id, type: "user_message", message: "Build backend" },
      { id: second.id, type: "session_started", sessionId: "session-1" },
    ]);
  });
});
