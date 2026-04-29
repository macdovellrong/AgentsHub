import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type RunHistoryRecord = {
  runId: string;
  profileId: string;
  command: string;
  args: string[];
  workspacePath: string;
  status: "running" | "exited";
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  runPath: string;
  rawLogPath: string;
  metaPath: string;
};

type RunMeta = Omit<RunHistoryRecord, "runPath" | "rawLogPath" | "metaPath">;

export class RunHistoryStore {
  async list(workspacePath: string): Promise<RunHistoryRecord[]> {
    const runsPath = path.join(workspacePath, ".agenthub", "runs");
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await readdir(runsPath, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const recordsById = new Map<string, RunHistoryRecord>();
    for (const record of await this.readLegacyIndex(workspacePath, runsPath)) {
      recordsById.set(record.runId, record);
    }

    const metaRecords = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.readMetaRecord(path.join(runsPath, entry.name))),
    );
    for (const record of metaRecords) {
      if (record) {
        recordsById.set(record.runId, record);
      }
    }

    return [...recordsById.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async readRawLog(workspacePath: string, runId: string): Promise<string> {
    if (runId.includes("/") || runId.includes("\\") || runId.includes("..") || path.isAbsolute(runId)) {
      throw new Error("Invalid run id");
    }
    return readFile(path.join(workspacePath, ".agenthub", "runs", runId, "raw.log"), "utf8");
  }

  private async readMetaRecord(runPath: string): Promise<RunHistoryRecord | null> {
    const metaPath = path.join(runPath, "meta.json");
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as RunMeta;
      return {
        ...meta,
        runPath,
        rawLogPath: path.join(runPath, "raw.log"),
        metaPath,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async readLegacyIndex(workspacePath: string, runsPath: string): Promise<RunHistoryRecord[]> {
    let content: string;
    try {
      content = await readFile(path.join(runsPath, "runs.jsonl"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const records: RunHistoryRecord[] = [];
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const legacy = this.parseJsonRecord(trimmed);
      if (!legacy) {
        continue;
      }

      const record = this.fromLegacyRecord(legacy, workspacePath, runsPath);
      if (record) {
        records.push(record);
      }
    }
    return records;
  }

  private parseJsonRecord(line: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(line) as unknown;
      return this.isObjectRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private fromLegacyRecord(
    legacy: Record<string, unknown>,
    workspacePath: string,
    runsPath: string,
  ): RunHistoryRecord | null {
    const runId = this.stringField(legacy, "run_id") ?? this.stringField(legacy, "runId");
    const profileId = this.stringField(legacy, "profile_id") ?? this.stringField(legacy, "profileId");
    const startedAt = this.stringField(legacy, "started_at") ?? this.stringField(legacy, "startedAt");
    if (!runId || !profileId || !startedAt) {
      return null;
    }

    const runPath = this.stringField(legacy, "run_dir") ?? path.join(runsPath, runId);
    const command = this.stringField(legacy, "command") ?? profileId;
    const status = this.stringField(legacy, "status") === "running" ? "running" : "exited";
    const endedAt = this.stringField(legacy, "ended_at") ?? this.stringField(legacy, "endedAt") ?? null;
    const exitCode = typeof legacy.exitCode === "number" ? legacy.exitCode : null;

    return {
      runId,
      profileId,
      command,
      args: this.stringArrayField(legacy, "args"),
      workspacePath: this.stringField(legacy, "workspace_path") ?? this.stringField(legacy, "workspacePath") ?? workspacePath,
      status,
      startedAt,
      endedAt,
      exitCode,
      runPath,
      rawLogPath: this.stringField(legacy, "raw_log_path") ?? path.join(runPath, "raw.log"),
      metaPath: path.join(runPath, "meta.json"),
    };
  }

  private isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private stringField(record: Record<string, unknown>, key: string): string | null {
    const value = record[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private stringArrayField(record: Record<string, unknown>, key: string): string[] {
    const value = record[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }
}
