import { randomUUID } from "node:crypto";
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
  private readonly appendQueues = new Map<string, Promise<void>>();

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const runId = this.createRunId();
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
    const previous = this.appendQueues.get(runId) ?? Promise.resolve();
    const next = previous.then(() => appendFile(run.rawLogPath, chunk, "utf8"));
    this.appendQueues.set(
      runId,
      next.catch(() => {
        // Keep later writes from being permanently blocked by one failed append.
      }),
    );
    await next;
  }

  async markExited(runId: string, exitCode: number | null): Promise<void> {
    const run = this.requireRun(runId);
    await this.waitForPendingAppends(runId);
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

  private createRunId(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${stamp}-${randomUUID()}`;
  }

  private async waitForPendingAppends(runId: string): Promise<void> {
    const pending = this.appendQueues.get(runId);
    if (pending) {
      await pending;
    }
  }
}
