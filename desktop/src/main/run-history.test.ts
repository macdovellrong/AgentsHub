import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunLogStore } from "./log-store";
import { RunHistoryStore } from "./run-history";

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("RunHistoryStore", () => {
  it("lists run metadata and reads raw logs", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-runs-"));
    const logStore = new RunLogStore();
    const run = await logStore.createRun({
      workspacePath,
      profileId: "codex",
      command: "codex",
      args: ["--ask"],
    });
    await writeFile(run.rawLogPath, "raw output", "utf8");
    const history = new RunHistoryStore();

    await expect(history.list(workspacePath)).resolves.toMatchObject([
      { runId: run.runId, profileId: "codex", command: "codex", rawLogPath: run.rawLogPath },
    ]);
    await expect(history.readRawLog(workspacePath, run.runId)).resolves.toBe("raw output");
    await expect(history.readRawLog(workspacePath, "../outside")).rejects.toThrow("Invalid run id");
  });
});
