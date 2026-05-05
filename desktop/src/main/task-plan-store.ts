import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type TaskPlanStatus = "draft" | "running" | "paused" | "completed" | "failed" | "archived";
export type TaskPlanTaskStatus = "pending" | "running" | "review" | "done" | "failed" | "blocked";

export type TaskPlan = {
  id: string;
  title: string;
  status: TaskPlanStatus;
  managerProfileId: string;
  participantProfileIds: string[];
  date: string;
  directoryName: string;
  planPath: string;
  sourceTaskDir: string;
  sourcePlanPath: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskPlanSource = {
  directoryName: string;
  title: string;
  taskDir: string;
  sourcePlanPath: string;
};

export type TaskPlanTask = {
  id: string;
  title: string;
  status: TaskPlanTaskStatus;
  assigneeProfileId: string | null;
  attempt: number;
  description?: string;
  runId?: string | null;
  artifactPath?: string | null;
  updatedAt?: string;
};

export type TaskPlanEventType =
  | "created"
  | "manager_started"
  | "assigned"
  | "hook_completed"
  | "review_requested"
  | "approved"
  | "rejected"
  | "paused"
  | "delivery_failed"
  | "parse_error"
  | "unmatched_hook";

export type TaskPlanEvent = {
  id: string;
  type: TaskPlanEventType;
  timestamp: string;
  taskId?: string;
  fromProfileId?: string;
  toProfileId?: string;
  message?: string;
  artifactPath?: string;
  runId?: string;
  sessionId?: string;
  sourceEventId?: string;
};

export type TaskPlanEventInput = Omit<TaskPlanEvent, "id" | "timestamp"> & {
  id?: string;
  timestamp?: string;
};

export type CreateTaskPlanInput = {
  title: string;
  sourceTaskDirectoryName: string;
  managerProfileId: string;
  participantProfileIds: string[];
};

export type TaskPlanStoreOptions = {
  now?: () => Date;
};

export class TaskPlanStore {
  constructor(private readonly options: TaskPlanStoreOptions = {}) {}

  async createPlan(workspacePath: string, input: CreateTaskPlanInput): Promise<TaskPlan> {
    const sourceTaskDir = this.sourceTaskDirPath(workspacePath, input.sourceTaskDirectoryName);
    const sourcePlanPath = path.join(sourceTaskDir, "task-plan.md");
    const markdown = await readSourceTaskPlanMarkdown(sourcePlanPath);
    const now = this.now();
    const timestamp = now.toISOString();
    const date = timestamp.slice(0, 10);
    const time = timestamp.slice(11, 19).replace(/:/g, "");
    const title = input.title.trim() || "Task Plan";
    const slug = slugify(title);
    const directoryName = `${time}-${slug}`;
    const datePath = path.join(this.rootPath(workspacePath), date);
    const planPath = path.join(datePath, directoryName);
    const plan: TaskPlan = {
      id: `${date.replace(/-/g, "")}-${time}-${slug}`,
      title,
      status: "draft",
      managerProfileId: input.managerProfileId,
      participantProfileIds: input.participantProfileIds,
      date,
      directoryName,
      planPath,
      sourceTaskDir,
      sourcePlanPath,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await mkdir(datePath, { recursive: true });
    try {
      await mkdir(planPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`Task plan already exists: ${plan.id}`);
      }
      throw error;
    }
    await mkdir(path.join(planPath, "artifacts"));
    await writeFile(path.join(planPath, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    await writeFile(path.join(planPath, "task-plan.md"), markdown, "utf8");
    await writeFile(path.join(planPath, "tasks.jsonl"), "", "utf8");
    await writeFile(path.join(planPath, "events.jsonl"), "", "utf8");

    return plan;
  }

  async listSourceTasks(workspacePath: string): Promise<TaskPlanSource[]> {
    const rootPath = this.sourceRootPath(workspacePath);
    let entries;
    try {
      entries = await readdir(rootPath, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const sources: TaskPlanSource[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isSafeTaskSourceDirectoryName(entry.name)) {
        continue;
      }
      const taskDir = path.join(rootPath, entry.name);
      const sourcePlanPath = path.join(taskDir, "task-plan.md");
      try {
        const markdown = await readSourceTaskPlanMarkdown(sourcePlanPath);
        sources.push({
          directoryName: entry.name,
          title: extractMarkdownTitle(markdown) ?? entry.name,
          taskDir,
          sourcePlanPath,
        });
      } catch (error) {
        if ((error as Error).message.includes("Task source task-plan.md")) {
          continue;
        }
        throw error;
      }
    }

    return sources.sort((left, right) => left.directoryName.localeCompare(right.directoryName));
  }

  async listPlans(workspacePath: string): Promise<TaskPlan[]> {
    const rootPath = this.rootPath(workspacePath);
    let dateEntries;
    try {
      dateEntries = await readdir(rootPath, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const plans: TaskPlan[] = [];
    for (const dateEntry of dateEntries) {
      if (!dateEntry.isDirectory()) {
        continue;
      }

      const datePath = path.join(rootPath, dateEntry.name);
      for (const planEntry of await readdir(datePath, { withFileTypes: true })) {
        if (!planEntry.isDirectory()) {
          continue;
        }

        const planPath = path.join(datePath, planEntry.name);
        const plan = await readTaskPlan(path.join(planPath, "plan.json"), planPath, rootPath);
        if (plan) {
          plans.push(plan);
        }
      }
    }

    return plans.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getPlan(workspacePath: string, planId: string): Promise<TaskPlan> {
    const plan = (await this.listPlans(workspacePath)).find((candidate) => candidate.id === planId);
    if (!plan) {
      throw new Error(`Unknown task plan: ${planId}`);
    }
    return plan;
  }

  async updatePlanStatus(workspacePath: string, planId: string, status: TaskPlanStatus): Promise<TaskPlan> {
    const plan = await this.getPlan(workspacePath, planId);
    const updated: TaskPlan = {
      ...plan,
      status,
      updatedAt: this.now().toISOString(),
    };
    await writeFile(path.join(plan.planPath, "plan.json"), `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    return updated;
  }

  async readMarkdown(workspacePath: string, planId: string): Promise<string> {
    const plan = await this.getPlan(workspacePath, planId);
    return readFile(path.join(plan.planPath, "task-plan.md"), "utf8");
  }

  async appendTask(workspacePath: string, planId: string, task: TaskPlanTask): Promise<void> {
    const plan = await this.getPlan(workspacePath, planId);
    await appendFile(path.join(plan.planPath, "tasks.jsonl"), `${JSON.stringify(task)}\n`, "utf8");
  }

  async listTasks(workspacePath: string, planId: string): Promise<TaskPlanTask[]> {
    const history = await this.listTaskHistory(workspacePath, planId);
    return [...foldLatestTasks(history).values()];
  }

  async listTaskHistory(workspacePath: string, planId: string): Promise<TaskPlanTask[]> {
    const plan = await this.getPlan(workspacePath, planId);
    return readJsonl<TaskPlanTask>(path.join(plan.planPath, "tasks.jsonl"));
  }

  async appendEvent(workspacePath: string, planId: string, input: TaskPlanEventInput): Promise<TaskPlanEvent> {
    const plan = await this.getPlan(workspacePath, planId);
    const { id, timestamp, ...eventInput } = input;
    const event: TaskPlanEvent = {
      ...eventInput,
      id: id ?? randomUUID(),
      timestamp: timestamp ?? this.now().toISOString(),
    };
    await appendFile(path.join(plan.planPath, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }

  async listEvents(workspacePath: string, planId: string): Promise<TaskPlanEvent[]> {
    const plan = await this.getPlan(workspacePath, planId);
    return readJsonl<TaskPlanEvent>(path.join(plan.planPath, "events.jsonl"));
  }

  async writeArtifact(
    workspacePath: string,
    planId: string,
    fileName: string,
    content: string,
  ): Promise<{ relativePath: string; absolutePath: string }> {
    if (!isSafeArtifactFileName(fileName)) {
      throw new Error("Invalid artifact path");
    }

    const plan = await this.getPlan(workspacePath, planId);
    const artifactsPath = path.join(plan.planPath, "artifacts");
    await mkdir(artifactsPath, { recursive: true });

    const absolutePath = path.join(artifactsPath, fileName);
    try {
      await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`Task plan artifact already exists: ${fileName}`);
      }
      throw error;
    }

    return {
      relativePath: `artifacts/${fileName}`,
      absolutePath,
    };
  }

  private rootPath(workspacePath: string): string {
    return path.join(workspacePath, ".agenthub", "task-plans");
  }

  private sourceRootPath(workspacePath: string): string {
    return path.join(workspacePath, "tasks");
  }

  private sourceTaskDirPath(workspacePath: string, directoryName: string): string {
    if (!isSafeTaskSourceDirectoryName(directoryName)) {
      throw new Error("Invalid task source directory");
    }
    return path.join(this.sourceRootPath(workspacePath), directoryName);
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

async function readTaskPlan(filePath: string, planPath: string, rootPath: string): Promise<TaskPlan | null> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isTaskPlan(value) || !isPathInsideOrEqual(planPath, rootPath)) {
      return null;
    }
    const workspacePath = path.dirname(path.dirname(rootPath));
    const sourceTaskDir =
      typeof value.sourceTaskDir === "string" ? value.sourceTaskDir : path.join(workspacePath, "tasks");
    const sourcePlanPath =
      typeof value.sourcePlanPath === "string" ? value.sourcePlanPath : path.join(sourceTaskDir, "task-plan.md");
    return { ...value, planPath, sourceTaskDir, sourcePlanPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readSourceTaskPlanMarkdown(filePath: string): Promise<string> {
  let markdown: string;
  try {
    markdown = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Task source task-plan.md not found: ${filePath}`);
    }
    throw error;
  }

  if (markdown.trim().length === 0) {
    throw new Error(`Task source task-plan.md is empty: ${filePath}`);
  }
  return markdown;
}

function extractMarkdownTitle(markdown: string): string | null {
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^#\s+(.+?)\s*$/);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }
  return null;
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as T];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function isTaskPlan(value: unknown): value is TaskPlan {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const plan = value as Record<string, unknown>;
  return (
    typeof plan.id === "string" &&
    typeof plan.title === "string" &&
    isTaskPlanStatus(plan.status) &&
    typeof plan.managerProfileId === "string" &&
    Array.isArray(plan.participantProfileIds) &&
    plan.participantProfileIds.every((profileId) => typeof profileId === "string") &&
    typeof plan.date === "string" &&
    typeof plan.directoryName === "string" &&
    typeof plan.planPath === "string" &&
    typeof plan.createdAt === "string" &&
    typeof plan.updatedAt === "string"
  );
}

function isTaskPlanStatus(value: unknown): value is TaskPlanStatus {
  return (
    value === "draft" ||
    value === "running" ||
    value === "paused" ||
    value === "completed" ||
    value === "failed" ||
    value === "archived"
  );
}

function isSafeArtifactFileName(fileName: string): boolean {
  return (
    fileName.length > 0 &&
    fileName !== "." &&
    fileName !== ".." &&
    !fileName.includes("/") &&
    !fileName.includes("\\")
  );
}

function isSafeTaskSourceDirectoryName(directoryName: string): boolean {
  return (
    directoryName.trim().length > 0 &&
    directoryName !== "." &&
    directoryName !== ".." &&
    !directoryName.includes("/") &&
    !directoryName.includes("\\")
  );
}

function isPathInsideOrEqual(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function foldLatestTasks(tasks: TaskPlanTask[]): Map<string, TaskPlanTask> {
  const latest = new Map<string, TaskPlanTask>();
  for (const task of tasks) {
    latest.set(task.id, task);
  }
  return latest;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "task-plan";
}
