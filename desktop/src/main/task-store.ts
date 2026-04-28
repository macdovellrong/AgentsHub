import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export type TaskStatus = "pending" | "running" | "review" | "done" | "failed";

export type AgentTask = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  profileId: string | null;
  runId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateTaskInput = {
  title: string;
  description: string;
  status?: TaskStatus;
  profileId?: string | null;
  runId?: string | null;
};

export type UpdateTaskInput = Partial<Omit<AgentTask, "id" | "createdAt" | "updatedAt">>;

export class TaskStore {
  async list(workspacePath: string): Promise<AgentTask[]> {
    const tasks = new Map<string, AgentTask>();
    for (const task of await this.readAll(workspacePath)) {
      tasks.set(task.id, task);
    }
    return [...tasks.values()];
  }

  async create(workspacePath: string, input: CreateTaskInput): Promise<AgentTask> {
    const now = new Date().toISOString();
    const task: AgentTask = {
      id: randomUUID(),
      title: input.title,
      description: input.description,
      status: input.status ?? "pending",
      profileId: input.profileId ?? null,
      runId: input.runId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.append(workspacePath, task);
    return task;
  }

  async update(workspacePath: string, taskId: string, input: UpdateTaskInput): Promise<AgentTask> {
    const existing = (await this.list(workspacePath)).find((task) => task.id === taskId);
    if (!existing) {
      throw new Error(`Unknown task: ${taskId}`);
    }
    const updated: AgentTask = {
      ...existing,
      ...input,
      id: taskId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.append(workspacePath, updated);
    return updated;
  }

  private async readAll(workspacePath: string): Promise<AgentTask[]> {
    try {
      const raw = await readFile(this.taskPath(workspacePath), "utf8");
      return raw
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as AgentTask);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async append(workspacePath: string, task: AgentTask): Promise<void> {
    await mkdir(path.dirname(this.taskPath(workspacePath)), { recursive: true });
    await appendFile(this.taskPath(workspacePath), `${JSON.stringify(task)}\n`, "utf8");
  }

  private taskPath(workspacePath: string): string {
    return path.join(workspacePath, ".agenthub", "tasks", "tasks.jsonl");
  }
}
