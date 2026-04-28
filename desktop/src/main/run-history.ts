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

export class RunHistoryStore {
  async list(workspacePath: string): Promise<RunHistoryRecord[]> {
    const runsPath = path.join(workspacePath, ".agenthub", "runs");
    let entries: string[];
    try {
      entries = await readdir(runsPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const records = await Promise.all(
      entries.map(async (entry) => {
        const runPath = path.join(runsPath, entry);
        const metaPath = path.join(runPath, "meta.json");
        const meta = JSON.parse(await readFile(metaPath, "utf8")) as Omit<RunHistoryRecord, "runPath" | "rawLogPath" | "metaPath">;
        return {
          ...meta,
          runPath,
          rawLogPath: path.join(runPath, "raw.log"),
          metaPath,
        };
      }),
    );
    return records.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async readRawLog(workspacePath: string, runId: string): Promise<string> {
    if (runId.includes("/") || runId.includes("\\") || runId.includes("..") || path.isAbsolute(runId)) {
      throw new Error("Invalid run id");
    }
    return readFile(path.join(workspacePath, ".agenthub", "runs", runId, "raw.log"), "utf8");
  }
}
