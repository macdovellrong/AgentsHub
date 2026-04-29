import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ForwardStore } from "./forward-store";

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("ForwardStore", () => {
  it("creates and updates agent forwarding records in a jsonl log", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-forwards-"));
    const store = new ForwardStore();

    const forward = await store.create(workspacePath, {
      sourceProfileId: "claude",
      targetProfileId: "codex",
      message: "Implement the selected task.",
    });
    const updated = await store.update(workspacePath, forward.id, {
      status: "blocked",
      lastError: "No online session for codex",
    });

    expect(updated).toMatchObject({
      id: forward.id,
      sourceProfileId: "claude",
      targetProfileId: "codex",
      message: "Implement the selected task.",
      status: "blocked",
      lastError: "No online session for codex",
    });
    await expect(store.list(workspacePath)).resolves.toMatchObject([
      {
        id: forward.id,
        targetProfileId: "codex",
        status: "blocked",
      },
    ]);
  });
});
