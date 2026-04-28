import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type CreateRunInput = {
  workspacePath: string;
  profileId: string;
  command: string;
  args: string[];
};

export type RunRecord = {
  runId: string;
  workspacePath: string;
  runPath: string;
  rawLogPath: string;
  metaPath: string;
};

type RunMeta = {
  runId: string;
  profileId: string;
  command: string;
  args: string[];
  workspacePath: string;
  status: "running" | "exited";
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
};

export class RunLogStore {
  private readonly runs = new Map<string, RunRecord>();

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const runId = this.createRunId(input.profileId);
    const runPath = path.join(input.workspacePath, ".agenthub", "runs", runId);
    const rawLogPath = path.join(runPath, "raw.log");
    const metaPath = path.join(runPath, "meta.json");

    await mkdir(runPath, { recursive: true });

    const meta: RunMeta = {
      runId,
      profileId: input.profileId,
      command: input.command,
      args: input.args,
      workspacePath: input.workspacePath,
      status: "running",
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
    };

    await writeFile(rawLogPath, "", "utf8");
    await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

    const record: RunRecord = {
      runId,
      workspacePath: input.workspacePath,
      runPath,
      rawLogPath,
      metaPath,
    };
    this.runs.set(runId, record);
    return record;
  }

  async appendRaw(runId: string, chunk: string): Promise<void> {
    const run = this.requireRun(runId);
    await appendFile(run.rawLogPath, chunk, "utf8");
  }

  async markExited(runId: string, exitCode: number | null): Promise<void> {
    const run = this.requireRun(runId);
    const meta = JSON.parse(await readFile(run.metaPath, "utf8")) as RunMeta;
    meta.status = "exited";
    meta.exitCode = exitCode;
    meta.endedAt = new Date().toISOString();
    await writeFile(run.metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  }

  private requireRun(runId: string): RunRecord {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Unknown run: ${runId}`);
    }
    return run;
  }

  private createRunId(profileId: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const suffix = Math.random().toString(16).slice(2, 10);
    return `${stamp}-${profileId}-${suffix}`;
  }
}
