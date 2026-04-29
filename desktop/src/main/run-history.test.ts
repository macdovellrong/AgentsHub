import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("lists legacy runs.jsonl records when run directories do not contain meta files", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-runs-"));
    const runsPath = path.join(workspacePath, ".agenthub", "runs");
    const runId = "codex-20260428-112929-152036";
    const runPath = path.join(runsPath, runId);
    await mkdir(runPath, { recursive: true });
    await writeFile(path.join(runPath, "raw.log"), "legacy raw output", "utf8");
    await writeFile(path.join(runPath, "clean.log"), "legacy clean output", "utf8");
    await writeFile(
      path.join(runsPath, "runs.jsonl"),
      `${JSON.stringify({
        clean_log_path: path.join(runPath, "clean.log"),
        ended_at: "2026-04-28T03:29:59.022759+00:00",
        error_message: null,
        profile_id: "codex",
        profile_name: "Codex",
        raw_log_path: path.join(runPath, "raw.log"),
        run_dir: runPath,
        run_id: runId,
        started_at: "2026-04-28T03:29:29.160973+00:00",
        status: "stopped",
        workspace_path: workspacePath,
      })}\n`,
      "utf8",
    );

    const history = new RunHistoryStore();

    await expect(history.list(workspacePath)).resolves.toMatchObject([
      {
        runId,
        profileId: "codex",
        command: "codex",
        args: [],
        status: "exited",
        runPath,
        rawLogPath: path.join(runPath, "raw.log"),
      },
    ]);
  });

  it("ignores incomplete run directories and non-directory entries", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-runs-"));
    const runsPath = path.join(workspacePath, ".agenthub", "runs");
    await mkdir(path.join(runsPath, "incomplete-run"), { recursive: true });
    await writeFile(path.join(runsPath, "runs.jsonl"), "\n", "utf8");

    const history = new RunHistoryStore();

    await expect(history.list(workspacePath)).resolves.toEqual([]);
  });

  it("prefers meta records over duplicate legacy index records", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-runs-"));
    const logStore = new RunLogStore();
    const run = await logStore.createRun({
      workspacePath,
      profileId: "codex",
      command: "codex.cmd",
      args: ["--ask"],
    });
    await writeFile(
      path.join(workspacePath, ".agenthub", "runs", "runs.jsonl"),
      `${JSON.stringify({
        ended_at: null,
        profile_id: "legacy-codex",
        raw_log_path: path.join(run.runPath, "raw.log"),
        run_dir: run.runPath,
        run_id: run.runId,
        started_at: "2026-04-28T03:29:29.160973+00:00",
        status: "running",
        workspace_path: workspacePath,
      })}\n`,
      "utf8",
    );

    const history = new RunHistoryStore();

    await expect(history.list(workspacePath)).resolves.toMatchObject([
      { runId: run.runId, profileId: "codex", command: "codex.cmd", args: ["--ask"] },
    ]);
  });
});
