import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskStore } from "./task-store";

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("TaskStore", () => {
  it("creates and updates tasks in a jsonl task log", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-tasks-"));
    const store = new TaskStore();

    const task = await store.create(workspacePath, {
      title: "Implement backend",
      description: "Add stores",
      status: "pending",
      profileId: "codex",
      runId: null,
    });
    const updated = await store.update(workspacePath, task.id, { status: "running", runId: "run-1" });

    expect(updated).toMatchObject({ id: task.id, status: "running", runId: "run-1" });
    await expect(store.list(workspacePath)).resolves.toMatchObject([
      { id: task.id, title: "Implement backend", status: "running" },
    ]);
  });
});
