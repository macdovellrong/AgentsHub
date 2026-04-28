import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunLogStore } from "./log-store";

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("RunLogStore", () => {
  it("creates run metadata and appends raw terminal data", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-log-"));
    const store = new RunLogStore();

    const run = await store.createRun({
      workspacePath,
      profileId: "powershell",
      command: "powershell.exe",
      args: ["-NoLogo"],
    });

    await store.appendRaw(run.runId, "hello\r\n");
    await store.appendRaw(run.runId, "\u001b[32mgreen\u001b[0m\r\n");

    await expect(stat(run.rawLogPath)).resolves.toBeDefined();
    await expect(readFile(run.rawLogPath, "utf8")).resolves.toBe("hello\r\n\u001b[32mgreen\u001b[0m\r\n");

    const meta = JSON.parse(await readFile(run.metaPath, "utf8"));
    expect(meta.profileId).toBe("powershell");
    expect(meta.command).toBe("powershell.exe");
    expect(meta.status).toBe("running");
  });

  it("marks a run exited", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-log-"));
    const store = new RunLogStore();
    const run = await store.createRun({
      workspacePath,
      profileId: "powershell",
      command: "powershell.exe",
      args: [],
    });

    await store.markExited(run.runId, 0);

    const meta = JSON.parse(await readFile(run.metaPath, "utf8"));
    expect(meta.status).toBe("exited");
    expect(meta.exitCode).toBe(0);
    expect(typeof meta.endedAt).toBe("string");
  });

  it("keeps unsafe profile IDs out of run path segments", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-log-"));
    const store = new RunLogStore();
    const unsafeProfileId = "foo/../../outside:name*";

    const run = await store.createRun({
      workspacePath,
      profileId: unsafeProfileId,
      command: "powershell.exe",
      args: [],
    });

    const runsPath = path.join(workspacePath, ".agenthub", "runs");
    const relativeRunPath = path.relative(runsPath, run.runPath);
    expect(relativeRunPath).not.toBe("");
    expect(relativeRunPath.startsWith("..")).toBe(false);
    expect(path.isAbsolute(relativeRunPath)).toBe(false);
    expect(run.runId).not.toContain("/");
    expect(run.runId).not.toContain("\\");
    expect(run.runId).not.toContain(":");
    expect(run.runId).not.toContain("*");

    await expect(stat(path.join(workspacePath, ".agenthub", "outside:name*"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const meta = JSON.parse(await readFile(run.metaPath, "utf8"));
    expect(meta.profileId).toBe(unsafeProfileId);
  });

  it("serializes concurrent raw appends in call order", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-log-"));
    const store = new RunLogStore();
    const run = await store.createRun({
      workspacePath,
      profileId: "powershell",
      command: "powershell.exe",
      args: [],
    });

    await Promise.all([store.appendRaw(run.runId, "1"), store.appendRaw(run.runId, "2"), store.appendRaw(run.runId, "3")]);

    await expect(readFile(run.rawLogPath, "utf8")).resolves.toBe("123");
  });
});
