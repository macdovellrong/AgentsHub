# AgentHub Task Plan Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current controlled orchestration and task board UI with a new file-backed Task Plan Manager where Claude manages work, AgentHub stores state, routes messages, receives hooks, and displays progress.

**Architecture:** Add a new `TaskPlanStore` for per-plan file persistence under `.agenthub/task-plans/`, plus a `TaskPlanService` for Claude manager prompts, plan-level AgentHub commands, hook completion handling, and task state transitions. Keep legacy `TaskStore` and `OrchestrationService` in code, but remove their main UI entry points.

**Tech Stack:** Electron main/preload IPC, React renderer, TypeScript, Vitest, Node fs promises, existing PTY session gateway, existing hook receiver, existing `<agenthub>` command parser.

**2026-05-05 Correction:** `task-plan.md` is now a real project file under `<workspace>/tasks/<timestamp-title>/task-plan.md`. AgentHub creates dated snapshots under `.agenthub/task-plans/.../task-plan.md`; older snippets in this implementation plan that pass or paste a `markdown` request body or read `<workspace>/task-plan.md` are historical and should not be copied into new work. The current source of truth is `docs/superpowers/specs/2026-05-04-agenthub-task-plan-manager-design.md`.

---

## File Structure

- Create `desktop/src/main/task-plan-store.ts`: plan directory creation, plan metadata, markdown, JSONL tasks/events, artifact writing, path safety.
- Create `desktop/src/main/task-plan-store.test.ts`: persistence and path traversal tests.
- Modify `desktop/src/main/agent-command-parser.ts`: add plan-level commands.
- Modify `desktop/src/main/agent-command-parser.test.ts`: validate new commands and invalid payloads.
- Create `desktop/src/main/task-plan-service.ts`: business flow for plan creation, manager start, assignment, hook completion, review decisions.
- Create `desktop/src/main/task-plan-service.test.ts`: service behavior using fake session gateway and temp workspace.
- Modify `desktop/src/main/hook-receiver.ts`: accept `planId`, `plan_id`, and `x-agenthub-plan-id`; preserve plan metadata on `agent_output`.
- Modify `desktop/src/main/hook-receiver.test.ts`: hook metadata tests.
- Modify `desktop/src/shared/ipc.ts`: add Task Plan DTOs, request types, validators, and channels.
- Modify `desktop/src/preload/index.ts`: expose Task Plan IPC methods.
- Modify `desktop/src/renderer/src/vite-env.d.ts`: add Task Plan renderer API types.
- Modify `desktop/src/main/index.ts`: instantiate store/service and register Task Plan IPC handlers.
- Modify `desktop/src/renderer/src/App.tsx`: remove visible legacy orchestration/task board panels and add Task Plan panel.
- Modify `desktop/src/renderer/src/styles.css`: add Task Plan panel styles and remove no-longer-used visible legacy layout assumptions.
- Modify `desktop/src/renderer/src/workspace-layout.test.ts` and add `desktop/src/renderer/src/task-plan-layout.test.ts`: renderer contract tests.
- Modify `desktop/src/renderer/src/ui-text.ts` and `desktop/src/renderer/src/ui-text.test.ts`: add Chinese labels for Task Plan.

---

### Task 1: TaskPlanStore Persistence

**Files:**
- Create: `desktop/src/main/task-plan-store.ts`
- Create: `desktop/src/main/task-plan-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Add `desktop/src/main/task-plan-store.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskPlanStore } from "./task-plan-store";

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("TaskPlanStore", () => {
  it("creates a dated task plan directory with plan metadata and markdown", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-"));
    const store = new TaskPlanStore({
      now: () => new Date("2026-05-04T13:30:12.000Z"),
    });

    const plan = await store.createPlan(workspacePath, {
      title: "AgentHub UI Refactor",
      markdown: "# Tasks\n\n- [ ] Refactor UI",
      managerProfileId: "claude",
      participantProfileIds: ["codex", "gemini"],
    });

    expect(plan.id).toBe("20260504-133012-agenthub-ui-refactor");
    expect(plan.date).toBe("2026-05-04");
    expect(plan.directoryName).toBe("133012-agenthub-ui-refactor");
    expect(plan.status).toBe("draft");
    await expect(readFile(path.join(plan.planPath, "task-plan.md"), "utf8")).resolves.toContain("Refactor UI");
    await expect(readFile(path.join(plan.planPath, "plan.json"), "utf8")).resolves.toContain(plan.id);
  });

  it("appends tasks, events, and artifacts inside the selected plan directory", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-"));
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    const plan = await store.createPlan(workspacePath, {
      title: "Hook Work",
      markdown: "# Hook Work",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    });

    await store.appendTask(workspacePath, plan.id, {
      id: "T001",
      title: "Implement hook",
      status: "pending",
      assigneeProfileId: "codex",
      attempt: 0,
    });
    await store.appendEvent(workspacePath, plan.id, {
      type: "assigned",
      taskId: "T001",
      fromProfileId: "claude",
      toProfileId: "codex",
      message: "Implement hook",
    });
    const artifact = await store.writeArtifact(workspacePath, plan.id, "T001-codex-result.md", "Done");

    await expect(store.listTasks(workspacePath, plan.id)).resolves.toHaveLength(1);
    await expect(store.listEvents(workspacePath, plan.id)).resolves.toHaveLength(1);
    expect(artifact.relativePath).toBe("artifacts/T001-codex-result.md");
  });

  it("rejects artifact paths that escape the artifacts directory", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-"));
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    const plan = await store.createPlan(workspacePath, {
      title: "Safe Paths",
      markdown: "# Safe Paths",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    });

    await expect(store.writeArtifact(workspacePath, plan.id, "../escape.md", "bad")).rejects.toThrow("Invalid artifact path");
  });
});
```

- [ ] **Step 2: Run the failing store tests**

Run:

```powershell
cd desktop
npm test -- task-plan-store.test.ts
```

Expected: FAIL because `./task-plan-store` does not exist.

- [ ] **Step 3: Implement `TaskPlanStore`**

Create `desktop/src/main/task-plan-store.ts`:

```ts
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
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
  createdAt: string;
  updatedAt: string;
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

export type TaskPlanEvent = {
  id: string;
  type: "created" | "manager_started" | "assigned" | "hook_completed" | "review_requested" | "approved" | "rejected" | "paused" | "delivery_failed" | "parse_error" | "unmatched_hook";
  timestamp: string;
  taskId?: string;
  fromProfileId?: string;
  toProfileId?: string;
  message?: string;
  artifactPath?: string;
  runId?: string;
  sessionId?: string;
};

export type CreateTaskPlanInput = {
  title: string;
  markdown: string;
  managerProfileId: string;
  participantProfileIds: string[];
};

export class TaskPlanStore {
  constructor(private readonly options: { now?: () => Date } = {}) {}

  async createPlan(workspacePath: string, input: CreateTaskPlanInput): Promise<TaskPlan> {
    const now = this.now();
    const date = now.toISOString().slice(0, 10);
    const time = compactTime(now);
    const slug = slugify(input.title);
    const directoryName = `${time}-${slug}`;
    const id = `${date.replace(/-/g, "")}-${time}-${slug}`;
    const planPath = path.join(this.rootPath(workspacePath), date, directoryName);
    const plan: TaskPlan = {
      id,
      title: input.title.trim() || "Task Plan",
      status: "draft",
      managerProfileId: input.managerProfileId,
      participantProfileIds: input.participantProfileIds,
      date,
      directoryName,
      planPath,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await mkdir(path.join(planPath, "artifacts"), { recursive: true });
    await writeFile(path.join(planPath, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    await writeFile(path.join(planPath, "task-plan.md"), input.markdown, "utf8");
    await writeFile(path.join(planPath, "tasks.jsonl"), "", "utf8");
    await writeFile(path.join(planPath, "events.jsonl"), "", "utf8");
    await this.appendEvent(workspacePath, plan.id, { type: "created", message: plan.title });
    return plan;
  }

  async getPlan(workspacePath: string, planId: string): Promise<TaskPlan> {
    const plan = await this.findPlan(workspacePath, planId);
    if (!plan) {
      throw new Error(`Unknown task plan: ${planId}`);
    }
    return plan;
  }

  async listPlans(workspacePath: string): Promise<TaskPlan[]> {
    const root = this.rootPath(workspacePath);
    const { readdir } = await import("node:fs/promises");
    try {
      const dates = await readdir(root, { withFileTypes: true });
      const plans: TaskPlan[] = [];
      for (const dateEntry of dates.filter((entry) => entry.isDirectory())) {
        const datePath = path.join(root, dateEntry.name);
        for (const planEntry of await readdir(datePath, { withFileTypes: true })) {
          if (!planEntry.isDirectory()) {
            continue;
          }
          try {
            const raw = await readFile(path.join(datePath, planEntry.name, "plan.json"), "utf8");
            plans.push(JSON.parse(raw) as TaskPlan);
          } catch {
            continue;
          }
        }
      }
      return plans.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async readMarkdown(workspacePath: string, planId: string): Promise<string> {
    const plan = await this.getPlan(workspacePath, planId);
    return readFile(path.join(plan.planPath, "task-plan.md"), "utf8");
  }

  async appendTask(workspacePath: string, planId: string, task: TaskPlanTask): Promise<void> {
    const plan = await this.getPlan(workspacePath, planId);
    await appendFile(path.join(plan.planPath, "tasks.jsonl"), `${JSON.stringify({ ...task, updatedAt: this.now().toISOString() })}\n`, "utf8");
  }

  async listTasks(workspacePath: string, planId: string): Promise<TaskPlanTask[]> {
    const plan = await this.getPlan(workspacePath, planId);
    return readJsonl<TaskPlanTask>(path.join(plan.planPath, "tasks.jsonl"));
  }

  async appendEvent(workspacePath: string, planId: string, event: Omit<TaskPlanEvent, "id" | "timestamp">): Promise<TaskPlanEvent> {
    const plan = await this.getPlan(workspacePath, planId).catch(async () => {
      const plans = await this.listPlans(workspacePath);
      const match = plans.find((candidate) => candidate.id === planId);
      if (!match) {
        throw new Error(`Unknown task plan: ${planId}`);
      }
      return match;
    });
    const stored: TaskPlanEvent = { id: randomUUID(), timestamp: this.now().toISOString(), ...event };
    await appendFile(path.join(plan.planPath, "events.jsonl"), `${JSON.stringify(stored)}\n`, "utf8");
    return stored;
  }

  async listEvents(workspacePath: string, planId: string): Promise<TaskPlanEvent[]> {
    const plan = await this.getPlan(workspacePath, planId);
    return readJsonl<TaskPlanEvent>(path.join(plan.planPath, "events.jsonl"));
  }

  async writeArtifact(workspacePath: string, planId: string, fileName: string, content: string): Promise<{ relativePath: string; absolutePath: string }> {
    if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
      throw new Error("Invalid artifact path");
    }
    const plan = await this.getPlan(workspacePath, planId);
    const absolutePath = path.join(plan.planPath, "artifacts", fileName);
    await writeFile(absolutePath, content, "utf8");
    return { relativePath: path.join("artifacts", fileName).replace(/\\/g, "/"), absolutePath };
  }

  private async findPlan(workspacePath: string, planId: string): Promise<TaskPlan | null> {
    return (await this.listPlans(workspacePath)).find((plan) => plan.id === planId) ?? null;
  }

  private rootPath(workspacePath: string): string {
    return path.join(workspacePath, ".agenthub", "task-plans");
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function compactTime(date: Date): string {
  return date.toISOString().slice(11, 19).replace(/:/g, "");
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "task-plan";
}
```

- [ ] **Step 4: Run store tests and fix only store failures**

Run:

```powershell
cd desktop
npm test -- task-plan-store.test.ts
```

Expected: PASS with 3 tests.

---

### Task 2: Plan-Level AgentHub Commands

**Files:**
- Modify: `desktop/src/main/agent-command-parser.ts`
- Modify: `desktop/src/main/agent-command-parser.test.ts`

- [ ] **Step 1: Write failing command parser tests**

Append tests to `desktop/src/main/agent-command-parser.test.ts`:

```ts
it("parses task plan manager commands", () => {
  const parsed = parseAgentHubCommands([
    '<agenthub>{"action":"assign_task","plan_id":"P001","task_id":"T001","to":"codex","message":"Implement T001"}</agenthub>',
    '<agenthub>{"action":"approve_task","plan_id":"P001","task_id":"T001","summary":"Looks good"}</agenthub>',
    '<agenthub>{"action":"reject_task","plan_id":"P001","task_id":"T001","to":"codex","message":"Add tests"}</agenthub>',
    '<agenthub>{"action":"request_review","plan_id":"P001","task_id":"T001","to":"gemini","message":"Review risk"}</agenthub>',
    '<agenthub>{"action":"pause_plan","plan_id":"P001","reason":"Need user decision"}</agenthub>',
  ].join("\\n"));

  expect(parsed.errors).toEqual([]);
  expect(parsed.commands.map((command) => command.action)).toEqual([
    "assign_task",
    "approve_task",
    "reject_task",
    "request_review",
    "pause_plan",
  ]);
});

it("rejects task plan commands without required plan fields", () => {
  const parsed = parseAgentHubCommands([
    '<agenthub>{"action":"assign_task","task_id":"T001","to":"codex","message":"Missing plan"}</agenthub>',
    '<agenthub>{"action":"approve_task","plan_id":"P001","summary":"Missing task"}</agenthub>',
    '<agenthub>{"action":"pause_plan","plan_id":12,"reason":"Bad plan"}</agenthub>',
  ].join("\\n"));

  expect(parsed.commands).toEqual([]);
  expect(parsed.errors.map((error) => error.code)).toEqual(["invalid_command", "invalid_command", "invalid_command"]);
});
```

- [ ] **Step 2: Run failing parser tests**

Run:

```powershell
cd desktop
npm test -- agent-command-parser.test.ts
```

Expected: FAIL with unsupported actions.

- [ ] **Step 3: Extend `AgentHubCommand` and validators**

Modify `desktop/src/main/agent-command-parser.ts`:

```ts
export type AgentHubCommand =
  | { action: "send"; target: string; task_id: string; message: string }
  | { action: "send_message"; to: string; message: string; team_id?: string; task_id?: string; conversation_id?: string }
  | { action: "claim_task"; task_id: string; team_id?: string }
  | { action: "complete_task"; task_id: string; summary?: string; team_id?: string }
  | { action: "assign_task"; plan_id: string; task_id: string; to: string; message: string }
  | { action: "approve_task"; plan_id: string; task_id: string; summary: string }
  | { action: "reject_task"; plan_id: string; task_id: string; to: string; message: string }
  | { action: "request_review"; plan_id: string; task_id: string; to: string; message: string }
  | { action: "pause_plan"; plan_id: string; reason: string }
  | {
      action: "continue";
      proposal_version: number;
      message?: string;
      artifact_path?: string;
      message_to?: string;
      summary?: string;
      stance?: string;
    }
  | {
      action: "accept";
      proposal_version: number;
      summary: string;
      artifact_path?: string;
      message_to?: string;
      stance?: string;
    }
  | { action: "ask_user"; message: string }
  | { action: "done"; message?: string };
```

Add switch cases:

```ts
case "assign_task":
  return validateAssignTaskCommand(value, index, block);
case "approve_task":
  return validateApproveTaskCommand(value, index, block);
case "reject_task":
  return validateRejectTaskCommand(value, index, block);
case "request_review":
  return validateRequestReviewCommand(value, index, block);
case "pause_plan":
  return validatePausePlanCommand(value, index, block);
```

Add validators:

```ts
function validateAssignTaskCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const required = requireStringFields(value, ["plan_id", "task_id", "to", "message"], index, block, "assign_task");
  return "error" in required ? required : { command: { action: "assign_task", ...required.fields } };
}

function validateApproveTaskCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const required = requireStringFields(value, ["plan_id", "task_id", "summary"], index, block, "approve_task");
  return "error" in required ? required : { command: { action: "approve_task", ...required.fields } };
}

function validateRejectTaskCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const required = requireStringFields(value, ["plan_id", "task_id", "to", "message"], index, block, "reject_task");
  return "error" in required ? required : { command: { action: "reject_task", ...required.fields } };
}

function validateRequestReviewCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const required = requireStringFields(value, ["plan_id", "task_id", "to", "message"], index, block, "request_review");
  return "error" in required ? required : { command: { action: "request_review", ...required.fields } };
}

function validatePausePlanCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const required = requireStringFields(value, ["plan_id", "reason"], index, block, "pause_plan");
  return "error" in required ? required : { command: { action: "pause_plan", ...required.fields } };
}

function requireStringFields(
  value: JsonRecord,
  fieldNames: string[],
  index: number,
  block: string,
  action: string,
): { fields: Record<string, string> } | { error: AgentHubCommandParseError } {
  const fields: Record<string, string> = {};
  for (const fieldName of fieldNames) {
    const field = requireStringField(value, fieldName);
    if (!field.ok) {
      return invalidCommand(index, block, `${action} command requires string field "${fieldName}"`);
    }
    fields[fieldName] = field.value;
  }
  return { fields };
}
```

- [ ] **Step 4: Run parser tests**

Run:

```powershell
cd desktop
npm test -- agent-command-parser.test.ts
```

Expected: PASS.

---

### Task 3: TaskPlanService Manager Flow

**Files:**
- Create: `desktop/src/main/task-plan-service.ts`
- Create: `desktop/src/main/task-plan-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `desktop/src/main/task-plan-service.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventStore } from "./event-store";
import { TaskPlanService, type TaskPlanSessionGateway } from "./task-plan-service";
import { TaskPlanStore } from "./task-plan-store";

class FakeGateway implements TaskPlanSessionGateway {
  sessions: ReturnType<TaskPlanSessionGateway["listSessions"]> = [];
  writes: Array<{ sessionId: string; data: string }> = [];

  listSessions(): ReturnType<TaskPlanSessionGateway["listSessions"]> {
    return this.sessions;
  }

  write(sessionId: string, data: string): void {
    this.writes.push({ sessionId, data });
  }
}

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("TaskPlanService", () => {
  it("starts Claude management with a plan-aware prompt", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-service-"));
    const gateway = new FakeGateway();
    gateway.sessions = [{ sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" }];
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    const service = new TaskPlanService(store, new EventStore(), gateway);
    const plan = await service.createPlan(workspacePath, {
      title: "Manager Work",
      markdown: "# Manager Work",
      managerProfileId: "claude",
      participantProfileIds: ["codex", "gemini"],
    });

    await service.startManager(workspacePath, { planId: plan.id });

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.writes[0].sessionId).toBe("claude-session");
    expect(gateway.writes[0].data).toContain(`Plan ID: ${plan.id}`);
    expect(gateway.writes[0].data).toContain("assign_task");
    expect(await store.listEvents(workspacePath, plan.id)).toContainEqual(expect.objectContaining({ type: "manager_started" }));
  });

  it("routes assign_task commands to the target agent and records plan events", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-service-"));
    const gateway = new FakeGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    const service = new TaskPlanService(store, new EventStore(), gateway);
    const plan = await service.createPlan(workspacePath, {
      title: "Assign Work",
      markdown: "# Assign Work",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    });

    await service.handleManagerCommand(workspacePath, "claude", {
      action: "assign_task",
      plan_id: plan.id,
      task_id: "T001",
      to: "codex",
      message: "Implement T001",
    });

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.writes[0]).toMatchObject({ sessionId: "codex-session" });
    expect(gateway.writes[0].data).toContain(`Plan: ${plan.id}`);
    expect(gateway.writes[0].data).toContain("Task: T001");
    expect(await store.listEvents(workspacePath, plan.id)).toContainEqual(expect.objectContaining({ type: "assigned", taskId: "T001" }));
  });

  it("records hook completion artifacts and notifies Claude", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-service-"));
    const gateway = new FakeGateway();
    gateway.sessions = [{ sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" }];
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    const service = new TaskPlanService(store, new EventStore(), gateway);
    const plan = await service.createPlan(workspacePath, {
      title: "Hook Work",
      markdown: "# Hook Work",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    });

    await service.handleHookCompletion(workspacePath, {
      planId: plan.id,
      taskId: "T001",
      profileId: "codex",
      sessionId: "codex-session",
      runId: "run-1",
      message: "Implemented T001",
    });

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.writes[0].data).toContain("子任务 T001 已完成");
    expect(await store.listEvents(workspacePath, plan.id)).toContainEqual(expect.objectContaining({ type: "hook_completed", taskId: "T001" }));
  });
});
```

- [ ] **Step 2: Run failing service tests**

Run:

```powershell
cd desktop
npm test -- task-plan-service.test.ts
```

Expected: FAIL because `./task-plan-service` does not exist.

- [ ] **Step 3: Implement `TaskPlanService`**

Create `desktop/src/main/task-plan-service.ts`:

```ts
import { EventStore } from "./event-store";
import type { AgentHubCommand } from "./agent-command-parser";
import { TaskPlanStore, type CreateTaskPlanInput, type TaskPlan } from "./task-plan-store";
import { toSubmittedTerminalInput } from "./terminal-input";

export type TaskPlanSession = {
  sessionId: string;
  profileId: string;
  workspacePath: string;
  status: "online" | "exited";
};

export type TaskPlanSessionGateway = {
  listSessions(): TaskPlanSession[];
  write(sessionId: string, data: string): void;
};

export type HookCompletionInput = {
  planId: string;
  taskId: string;
  profileId: string;
  sessionId?: string;
  runId?: string;
  message: string;
};

export class TaskPlanService {
  constructor(
    private readonly store = new TaskPlanStore(),
    private readonly eventStore = new EventStore(),
    private readonly sessions: TaskPlanSessionGateway,
  ) {}

  createPlan(workspacePath: string, input: CreateTaskPlanInput): Promise<TaskPlan> {
    return this.store.createPlan(workspacePath, input);
  }

  listPlans(workspacePath: string): Promise<TaskPlan[]> {
    return this.store.listPlans(workspacePath);
  }

  async startManager(workspacePath: string, input: { planId: string }): Promise<TaskPlan> {
    const plan = await this.store.getPlan(workspacePath, input.planId);
    const session = this.findOnlineSession(workspacePath, plan.managerProfileId);
    if (!session) {
      await this.store.appendEvent(workspacePath, plan.id, {
        type: "delivery_failed",
        toProfileId: plan.managerProfileId,
        message: `Manager profile is offline: ${plan.managerProfileId}`,
      });
      throw new Error(`Manager profile is offline: ${plan.managerProfileId}`);
    }
    this.sessions.write(session.sessionId, toSubmittedTerminalInput(await this.buildManagerPrompt(workspacePath, plan)));
    await this.store.appendEvent(workspacePath, plan.id, {
      type: "manager_started",
      toProfileId: plan.managerProfileId,
      sessionId: session.sessionId,
      message: `Manager started: ${plan.title}`,
    });
    await this.eventStore.append(workspacePath, {
      type: "orchestration_step",
      profileId: plan.managerProfileId,
      status: "manager_started",
      message: `任务计划已交给 ${plan.managerProfileId} 管理：${plan.title}`,
      metadata: { planId: plan.id },
    });
    return plan;
  }

  async handleManagerCommand(workspacePath: string, fromProfileId: string, command: AgentHubCommand): Promise<void> {
    if (command.action === "assign_task") {
      await this.assignTask(workspacePath, fromProfileId, command.plan_id, command.task_id, command.to, command.message);
      return;
    }
    if (command.action === "request_review") {
      await this.assignTask(workspacePath, fromProfileId, command.plan_id, command.task_id, command.to, command.message, "review_requested");
      return;
    }
    if (command.action === "approve_task") {
      await this.store.appendEvent(workspacePath, command.plan_id, {
        type: "approved",
        taskId: command.task_id,
        fromProfileId,
        message: command.summary,
      });
      return;
    }
    if (command.action === "reject_task") {
      await this.assignTask(workspacePath, fromProfileId, command.plan_id, command.task_id, command.to, command.message, "rejected");
      return;
    }
    if (command.action === "pause_plan") {
      await this.store.appendEvent(workspacePath, command.plan_id, {
        type: "paused",
        fromProfileId,
        message: command.reason,
      });
    }
  }

  async handleHookCompletion(workspacePath: string, input: HookCompletionInput): Promise<void> {
    const plan = await this.store.getPlan(workspacePath, input.planId);
    const artifact = await this.store.writeArtifact(
      workspacePath,
      plan.id,
      `${input.taskId}-${input.profileId}-result.md`,
      input.message,
    );
    await this.store.appendEvent(workspacePath, plan.id, {
      type: "hook_completed",
      taskId: input.taskId,
      fromProfileId: input.profileId,
      sessionId: input.sessionId,
      runId: input.runId,
      artifactPath: artifact.relativePath,
      message: `Task completed by ${input.profileId}`,
    });
    const managerSession = this.findOnlineSession(workspacePath, plan.managerProfileId);
    if (!managerSession) {
      await this.store.appendEvent(workspacePath, plan.id, {
        type: "delivery_failed",
        taskId: input.taskId,
        toProfileId: plan.managerProfileId,
        message: `Manager profile is offline: ${plan.managerProfileId}`,
      });
      return;
    }
    this.sessions.write(managerSession.sessionId, toSubmittedTerminalInput([
      `子任务 ${input.taskId} 已完成。`,
      `计划：${plan.id}`,
      `执行者：${input.profileId}`,
      input.runId ? `Run：${input.runId}` : null,
      `产物：${artifact.relativePath}`,
      "",
      "请审查结果。通过则输出 approve_task 并派发下一项；不通过则输出 reject_task 并说明修改意见。",
    ].filter((line): line is string => line !== null).join("\r\n")));
  }

  private async assignTask(
    workspacePath: string,
    fromProfileId: string,
    planId: string,
    taskId: string,
    toProfileId: string,
    message: string,
    eventType: "assigned" | "review_requested" | "rejected" = "assigned",
  ): Promise<void> {
    const target = this.findOnlineSession(workspacePath, toProfileId);
    if (!target) {
      await this.store.appendEvent(workspacePath, planId, {
        type: "delivery_failed",
        taskId,
        fromProfileId,
        toProfileId,
        message: `Target profile is offline: ${toProfileId}`,
      });
      return;
    }
    this.sessions.write(target.sessionId, toSubmittedTerminalInput([
      "AgentHub task plan assignment.",
      `Plan: ${planId}`,
      `Task: ${taskId}`,
      `From: ${fromProfileId}`,
      "",
      message,
      "",
      "When complete, let your configured hook report the final result to AgentHub.",
    ].join("\r\n")));
    await this.store.appendEvent(workspacePath, planId, {
      type: eventType,
      taskId,
      fromProfileId,
      toProfileId,
      sessionId: target.sessionId,
      message,
    });
    await this.eventStore.append(workspacePath, {
      type: "agent_forward",
      profileId: fromProfileId,
      targetProfileId: toProfileId,
      taskId,
      deliveryStatus: "sent",
      message,
      metadata: { planId },
    });
  }

  private async buildManagerPrompt(workspacePath: string, plan: TaskPlan): Promise<string> {
    const markdown = await this.store.readMarkdown(workspacePath, plan.id);
    return [
      "AgentHub Task Plan Manager.",
      `Plan ID: ${plan.id}`,
      `Plan directory: ${plan.planPath}`,
      `Task plan file: ${plan.planPath.replace(/\\/g, "/")}/task-plan.md`,
      `Available agents: ${plan.participantProfileIds.join(", ")}`,
      "",
      "You are the manager. Read the task plan, choose one bounded subtask, and use <agenthub> commands.",
      "Commands: assign_task, approve_task, reject_task, request_review, pause_plan.",
      "",
      markdown,
    ].join("\r\n");
  }

  private findOnlineSession(workspacePath: string, profileId: string): TaskPlanSession | undefined {
    return this.sessions
      .listSessions()
      .find((session) => session.workspacePath === workspacePath && session.profileId === profileId && session.status === "online");
  }
}
```

- [ ] **Step 4: Run service tests**

Run:

```powershell
cd desktop
npm test -- task-plan-service.test.ts
```

Expected: PASS.

---

### Task 4: Hook Receiver Plan Metadata

**Files:**
- Modify: `desktop/src/main/hook-receiver.ts`
- Modify: `desktop/src/main/hook-receiver.test.ts`

- [ ] **Step 1: Write failing hook metadata test**

Add to `desktop/src/main/hook-receiver.test.ts`:

```ts
it("preserves task plan metadata from payload and headers", async () => {
  const receiver = new AgentResultHookReceiver({ eventStore, token: "token", port: 0 });
  const info = await receiver.start();
  try {
    const response = await fetch(info.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agenthub-token": "token",
        "x-agenthub-plan-id": "P001",
        "x-agenthub-task-id": "T001",
      },
      body: JSON.stringify({
        workspace: workspacePath,
        profileId: "codex",
        agenthubSessionId: "codex-session",
        runId: "run-1",
        message: "Implemented task",
      }),
    });

    expect(response.status).toBe(200);
    const events = await eventStore.list(workspacePath);
    expect(events[0]).toMatchObject({
      type: "agent_output",
      profileId: "codex",
      taskId: "T001",
      metadata: expect.objectContaining({ planId: "P001" }),
    });
  } finally {
    await receiver.stop();
  }
});
```

- [ ] **Step 2: Run failing hook test**

Run:

```powershell
cd desktop
npm test -- hook-receiver.test.ts
```

Expected: FAIL because `planId` is not extracted.

- [ ] **Step 3: Extend hook payload and event metadata**

Modify `AgentResultPayload` in `desktop/src/main/hook-receiver.ts`:

```ts
  planId?: unknown;
  plan_id?: unknown;
```

Inside `handleRequest`, extract plan ID:

```ts
const planId =
  optionalString(payload.planId) ?? optionalString(payload.plan_id) ?? headerString(request, "x-agenthub-plan-id");
```

Add `planId` to metadata:

```ts
metadata: {
  source: optionalString(payload.source) ?? headerString(request, "x-agenthub-source"),
  hookEvent: optionalString(payload.hookEvent) ?? optionalString(payload.hook_event_name),
  providerSessionId: optionalString(payload.providerSessionId) ?? optionalString(payload.session_id),
  providerTurnId:
    optionalString(payload.providerTurnId) ?? optionalString(payload.turn_id) ?? optionalString(payload.request_id),
  model: optionalString(payload.model),
  cwd: optionalString(payload.cwd),
  teamId,
  planId,
},
```

- [ ] **Step 4: Run hook tests**

Run:

```powershell
cd desktop
npm test -- hook-receiver.test.ts
```

Expected: PASS.

---

### Task 5: Connect TaskPlanService To Hook And Commands

**Files:**
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/main/task-plan-service.test.ts`

- [ ] **Step 1: Write failing integration behavior test in service**

Append to `desktop/src/main/task-plan-service.test.ts`:

```ts
it("ignores agent output without task plan commands", async () => {
  workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-service-"));
  const gateway = new FakeGateway();
  const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
  const service = new TaskPlanService(store, new EventStore(), gateway);

  await service.handleAgentOutput(workspacePath, {
    id: "event-1",
    type: "agent_output",
    timestamp: "2026-05-04T13:30:12.000Z",
    profileId: "claude",
    message: "No command here",
  });

  expect(gateway.writes).toEqual([]);
});
```

- [ ] **Step 2: Run failing service test**

Run:

```powershell
cd desktop
npm test -- task-plan-service.test.ts
```

Expected: FAIL because `handleAgentOutput` is not implemented.

- [ ] **Step 3: Implement `handleAgentOutput`**

Modify `desktop/src/main/task-plan-service.ts`:

```ts
import { parseAgentHubCommands } from "./agent-command-parser";
import type { AgentHubEvent } from "./event-store";
```

Add method:

```ts
async handleAgentOutput(workspacePath: string, event: AgentHubEvent): Promise<void> {
  if (event.type !== "agent_output" || !event.profileId || !event.message) {
    return;
  }
  const parsed = parseAgentHubCommands(event.message);
  for (const error of parsed.errors) {
    await this.eventStore.append(workspacePath, {
      type: "error",
      profileId: event.profileId,
      parentEventId: event.id,
      message: error.message,
      error: error.message,
      metadata: { planCommandParseError: error },
    });
  }
  for (const command of parsed.commands) {
    if (
      command.action === "assign_task" ||
      command.action === "approve_task" ||
      command.action === "reject_task" ||
      command.action === "request_review" ||
      command.action === "pause_plan"
    ) {
      await this.handleManagerCommand(workspacePath, event.profileId, command);
    }
  }
  const planId = typeof event.metadata?.planId === "string" ? event.metadata.planId : undefined;
  if (planId && event.taskId && event.profileId !== "claude") {
    await this.handleHookCompletion(workspacePath, {
      planId,
      taskId: event.taskId,
      profileId: event.profileId,
      sessionId: event.sessionId,
      runId: event.runId,
      message: event.message,
    });
  }
}
```

- [ ] **Step 4: Wire service in `desktop/src/main/index.ts`**

Add imports:

```ts
import { TaskPlanService } from "./task-plan-service";
import { TaskPlanStore } from "./task-plan-store";
```

Instantiate:

```ts
const taskPlanStore = new TaskPlanStore();
let taskPlanService: TaskPlanService | null = null;
```

After `manager` exists:

```ts
taskPlanService = new TaskPlanService(taskPlanStore, eventStore, manager);
```

Update hook observation:

```ts
await taskPlanService?.handleAgentOutput(workspacePath, event);
await teamCommandService?.handleAgentOutput(workspacePath, event);
await conversationOrchestrator?.handleAgentOutput(workspacePath, event);
```

- [ ] **Step 5: Run service and hook tests**

Run:

```powershell
cd desktop
npm test -- task-plan-service.test.ts hook-receiver.test.ts
```

Expected: PASS.

---

### Task 6: Task Plan IPC And Preload API

**Files:**
- Modify: `desktop/src/shared/ipc.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/src/vite-env.d.ts`
- Modify: `desktop/src/main/index.ts`
- Create: `desktop/src/shared/task-plan-ipc.test.ts`

- [ ] **Step 1: Write failing IPC tests**

Create `desktop/src/shared/task-plan-ipc.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  IpcChannels,
  isCreateTaskPlanRequest,
  isTaskPlanActionRequest,
} from "./ipc";

describe("task plan ipc contracts", () => {
  it("declares task plan channels", () => {
    expect(IpcChannels.TaskPlansList).toBe("task-plans:list");
    expect(IpcChannels.TaskPlansCreate).toBe("task-plans:create");
    expect(IpcChannels.TaskPlansStartManager).toBe("task-plans:startManager");
    expect(IpcChannels.TaskPlansReadMarkdown).toBe("task-plans:readMarkdown");
    expect(IpcChannels.TaskPlansOpenFolder).toBe("task-plans:openFolder");
  });

  it("validates create and action requests", () => {
    expect(isCreateTaskPlanRequest({
      workspacePath: "C:/work",
      title: "Plan",
      markdown: "# Plan",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    })).toBe(true);
    expect(isTaskPlanActionRequest({ workspacePath: "C:/work", planId: "P001" })).toBe(true);
    expect(isCreateTaskPlanRequest({ title: "", markdown: "# Plan", managerProfileId: "claude", participantProfileIds: [] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run failing IPC tests**

Run:

```powershell
cd desktop
npm test -- task-plan-ipc.test.ts
```

Expected: FAIL because channels and validators are missing.

- [ ] **Step 3: Add IPC types and validators**

Modify `desktop/src/shared/ipc.ts`:

```ts
TaskPlansList: "task-plans:list",
TaskPlansCreate: "task-plans:create",
TaskPlansStartManager: "task-plans:startManager",
TaskPlansReadMarkdown: "task-plans:readMarkdown",
TaskPlansOpenFolder: "task-plans:openFolder",
```

Add DTOs:

```ts
export type TaskPlanDto = {
  id: string;
  title: string;
  status: "draft" | "running" | "paused" | "completed" | "failed" | "archived";
  managerProfileId: string;
  participantProfileIds: string[];
  date: string;
  directoryName: string;
  planPath: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateTaskPlanRequest = WorkspaceRequest & {
  title: string;
  markdown: string;
  managerProfileId: string;
  participantProfileIds: string[];
};

export type TaskPlanActionRequest = WorkspaceRequest & {
  planId: string;
};
```

Add validators:

```ts
export function isCreateTaskPlanRequest(value: unknown): value is CreateTaskPlanRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isOptionalString(candidate.workspacePath) &&
    typeof candidate.title === "string" &&
    candidate.title.trim().length > 0 &&
    typeof candidate.markdown === "string" &&
    candidate.markdown.trim().length > 0 &&
    typeof candidate.managerProfileId === "string" &&
    candidate.managerProfileId.trim().length > 0 &&
    Array.isArray(candidate.participantProfileIds) &&
    candidate.participantProfileIds.length > 0 &&
    candidate.participantProfileIds.every((profileId) => typeof profileId === "string" && profileId.trim().length > 0)
  );
}

export function isTaskPlanActionRequest(value: unknown): value is TaskPlanActionRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return isOptionalString(candidate.workspacePath) && typeof candidate.planId === "string" && candidate.planId.trim().length > 0;
}
```

- [ ] **Step 4: Expose preload and renderer types**

Modify `desktop/src/preload/index.ts` imports and `agenthub`:

```ts
createTaskPlan(request: CreateTaskPlanRequest): Promise<TaskPlanDto> {
  return ipcRenderer.invoke(IpcChannels.TaskPlansCreate, request) as Promise<TaskPlanDto>;
},

listTaskPlans(request: WorkspaceRequest = {}): Promise<TaskPlanDto[]> {
  return ipcRenderer.invoke(IpcChannels.TaskPlansList, request) as Promise<TaskPlanDto[]>;
},

startTaskPlanManager(request: TaskPlanActionRequest): Promise<TaskPlanDto> {
  return ipcRenderer.invoke(IpcChannels.TaskPlansStartManager, request) as Promise<TaskPlanDto>;
},

readTaskPlanMarkdown(request: TaskPlanActionRequest): Promise<string> {
  return ipcRenderer.invoke(IpcChannels.TaskPlansReadMarkdown, request) as Promise<string>;
},

openTaskPlanFolder(request: TaskPlanActionRequest): Promise<void> {
  return ipcRenderer.invoke(IpcChannels.TaskPlansOpenFolder, request) as Promise<void>;
},
```

Mirror these methods in `desktop/src/renderer/src/vite-env.d.ts`.

- [ ] **Step 5: Register main IPC handlers**

Modify `desktop/src/main/index.ts` imports:

```ts
  isCreateTaskPlanRequest,
  isTaskPlanActionRequest,
  type CreateTaskPlanRequest,
  type TaskPlanActionRequest,
```

Register handlers:

```ts
ipcMain.handle(IpcChannels.TaskPlansList, (_event, request: WorkspaceRequest = {}) =>
  taskPlanStore.listPlans(resolveRequestWorkspace(request.workspacePath)),
);

ipcMain.handle(IpcChannels.TaskPlansCreate, async (_event, request: CreateTaskPlanRequest) => {
  if (!isCreateTaskPlanRequest(request)) {
    throw new Error("Invalid task plan create request");
  }
  return taskPlanService!.createPlan(resolveRequestWorkspace(request.workspacePath), request);
});

ipcMain.handle(IpcChannels.TaskPlansStartManager, async (_event, request: TaskPlanActionRequest) => {
  if (!isTaskPlanActionRequest(request)) {
    throw new Error("Invalid task plan action request");
  }
  return taskPlanService!.startManager(resolveRequestWorkspace(request.workspacePath), { planId: request.planId });
});

ipcMain.handle(IpcChannels.TaskPlansReadMarkdown, async (_event, request: TaskPlanActionRequest) => {
  if (!isTaskPlanActionRequest(request)) {
    throw new Error("Invalid task plan action request");
  }
  return taskPlanStore.readMarkdown(resolveRequestWorkspace(request.workspacePath), request.planId);
});

ipcMain.handle(IpcChannels.TaskPlansOpenFolder, async (_event, request: TaskPlanActionRequest) => {
  if (!isTaskPlanActionRequest(request)) {
    throw new Error("Invalid task plan action request");
  }
  const plan = await taskPlanStore.getPlan(resolveRequestWorkspace(request.workspacePath), request.planId);
  await shell.openPath(plan.planPath);
});
```

- [ ] **Step 6: Run IPC and type checks**

Run:

```powershell
cd desktop
npm test -- task-plan-ipc.test.ts
npm run typecheck
```

Expected: PASS.

---

### Task 7: Renderer Task Plan Panel

**Files:**
- Modify: `desktop/src/renderer/src/App.tsx`
- Modify: `desktop/src/renderer/src/styles.css`
- Modify: `desktop/src/renderer/src/ui-text.ts`
- Modify: `desktop/src/renderer/src/ui-text.test.ts`
- Create: `desktop/src/renderer/src/task-plan-layout.test.ts`

- [ ] **Step 1: Write failing renderer layout tests**

Create `desktop/src/renderer/src/task-plan-layout.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rendererRoot = __dirname;

function readRendererFile(relativePath: string): string {
  return readFileSync(join(rendererRoot, relativePath), "utf8");
}

describe("task plan layout", () => {
  it("replaces visible orchestration and task board panels with task plan UI", () => {
    const appSource = readRendererFile("App.tsx");

    expect(appSource).toContain('className="task-plan-panel panel"');
    expect(appSource).toContain("listTaskPlans");
    expect(appSource).toContain("createTaskPlan");
    expect(appSource).toContain("startTaskPlanManager");
    expect(appSource).toContain("readTaskPlanMarkdown");
    expect(appSource).not.toContain('className="orchestration panel"');
    expect(appSource).not.toContain('className="tasks panel"');
  });
});
```

Update `desktop/src/renderer/src/ui-text.test.ts`:

```ts
it("labels the task plan section", () => {
  expect(UI_TEXT.sections.taskPlans).toBe("任务计划");
});
```

- [ ] **Step 2: Run failing renderer tests**

Run:

```powershell
cd desktop
npm test -- task-plan-layout.test.ts ui-text.test.ts
```

Expected: FAIL because Task Plan UI and labels are missing.

- [ ] **Step 3: Add renderer state and refresh calls**

Modify `desktop/src/renderer/src/App.tsx` imports:

```ts
  TaskPlanDto,
```

Add state:

```ts
const [taskPlans, setTaskPlans] = useState<TaskPlanDto[]>([]);
const [selectedTaskPlanId, setSelectedTaskPlanId] = useState<string | null>(null);
const [taskPlanMarkdown, setTaskPlanMarkdown] = useState("");
const [newTaskPlanTitle, setNewTaskPlanTitle] = useState("");
const [newTaskPlanMarkdown, setNewTaskPlanMarkdown] = useState("");
```

Extend `refreshWorkspaceData`:

```ts
const [nextEvents, nextConversations, nextRuns, nextTasks, nextTaskPlans] = await Promise.all([
  window.agenthub.listEvents(request),
  window.agenthub.listConversations(request),
  window.agenthub.listRuns(request),
  window.agenthub.listTasks(request),
  window.agenthub.listTaskPlans(request),
]);
setTaskPlans(nextTaskPlans);
```

Add handlers:

```ts
const selectedTaskPlan = taskPlans.find((plan) => plan.id === selectedTaskPlanId) ?? taskPlans[0] ?? null;

const createTaskPlanFromInput = useCallback(async () => {
  const title = newTaskPlanTitle.trim();
  const markdown = newTaskPlanMarkdown.trim();
  if (!title || !markdown) {
    return;
  }
  const created = await window.agenthub.createTaskPlan({
    workspacePath: workspacePath || undefined,
    title,
    markdown,
    managerProfileId: profiles.find((profile) => profile.kind === "claude")?.id ?? "claude",
    participantProfileIds: profiles.filter((profile) => profile.kind === "codex" || profile.kind === "gemini").map((profile) => profile.id),
  });
  setSelectedTaskPlanId(created.id);
  setNewTaskPlanTitle("");
  setNewTaskPlanMarkdown("");
  await refreshWorkspaceData();
}, [newTaskPlanMarkdown, newTaskPlanTitle, profiles, refreshWorkspaceData, workspacePath]);

const loadTaskPlanMarkdown = useCallback(async (planId: string) => {
  setSelectedTaskPlanId(planId);
  const markdown = await window.agenthub.readTaskPlanMarkdown({ workspacePath: workspacePath || undefined, planId });
  setTaskPlanMarkdown(markdown);
}, [workspacePath]);

const startSelectedTaskPlanManager = useCallback(async () => {
  if (!selectedTaskPlan) {
    return;
  }
  await window.agenthub.startTaskPlanManager({ workspacePath: workspacePath || undefined, planId: selectedTaskPlan.id });
  await refreshWorkspaceData();
}, [refreshWorkspaceData, selectedTaskPlan, workspacePath]);
```

- [ ] **Step 4: Replace visible panels in JSX**

Remove visible sections:

```tsx
<section className="orchestration panel">
  <div className="panel-header">
    <h2>{UI_TEXT.sections.orchestration}</h2>
  </div>
</section>

<section className="tasks panel">
  <div className="panel-header">
    <h2>{UI_TEXT.sections.tasks}</h2>
  </div>
</section>
```

Insert:

```tsx
<section className="task-plan-panel panel">
  <div className="panel-header">
    <h2>{UI_TEXT.sections.taskPlans}</h2>
    <span>{taskPlans.length} 个计划</span>
  </div>
  <div className="task-plan-create">
    <input
      value={newTaskPlanTitle}
      onChange={(event) => setNewTaskPlanTitle(event.target.value)}
      placeholder="计划标题"
    />
    <textarea
      value={newTaskPlanMarkdown}
      onChange={(event) => setNewTaskPlanMarkdown(event.target.value)}
      placeholder="粘贴 task-plan.md 内容"
    />
    <button type="button" onClick={() => void createTaskPlanFromInput()}>
      新建任务计划
    </button>
  </div>
  <div className="task-plan-body">
    <div className="task-plan-list">
      {taskPlans.map((plan) => (
        <button
          type="button"
          className={selectedTaskPlan?.id === plan.id ? "is-selected" : ""}
          key={plan.id}
          onClick={() => void loadTaskPlanMarkdown(plan.id)}
        >
          <strong>{plan.title}</strong>
          <span>{plan.date} · {plan.status}</span>
        </button>
      ))}
    </div>
    <div className="task-plan-detail">
      <pre>{taskPlanMarkdown || "选择一个任务计划查看内容"}</pre>
      <div className="button-row">
        <button type="button" onClick={() => void startSelectedTaskPlanManager()} disabled={!selectedTaskPlan}>
          交给 Claude 管理
        </button>
        <button
          type="button"
          onClick={() => selectedTaskPlan ? void window.agenthub.openTaskPlanFolder({ workspacePath: workspacePath || undefined, planId: selectedTaskPlan.id }) : undefined}
          disabled={!selectedTaskPlan}
        >
          打开计划目录
        </button>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 5: Add styles**

Modify `desktop/src/renderer/src/styles.css`:

```css
.task-plan-panel {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
}

.task-plan-create {
  border-bottom: 1px solid #27303a;
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(140px, 0.4fr) minmax(220px, 1fr) auto;
  padding: 10px;
}

.task-plan-create textarea {
  min-height: 58px;
  resize: vertical;
}

.task-plan-body {
  display: grid;
  gap: 10px;
  grid-template-columns: minmax(180px, 0.34fr) minmax(260px, 0.66fr);
  min-height: 0;
  padding: 10px;
}

.task-plan-list {
  display: grid;
  gap: 8px;
  min-height: 0;
  overflow: auto;
}

.task-plan-list button {
  align-items: start;
  display: grid;
  gap: 4px;
  justify-items: start;
  min-height: 48px;
  text-align: left;
}

.task-plan-list button.is-selected {
  background: #1b2836;
  border-color: #5f86b6;
}

.task-plan-detail {
  display: grid;
  gap: 8px;
  grid-template-rows: minmax(0, 1fr) auto;
  min-height: 0;
}

.task-plan-detail pre {
  background: #0f141a;
  border: 1px solid #28313c;
  border-radius: 7px;
  color: #d7dde8;
  font-family: "Cascadia Mono", "Cascadia Code", Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  margin: 0;
  overflow: auto;
  padding: 10px;
  white-space: pre-wrap;
}
```

- [ ] **Step 6: Update labels**

Modify `desktop/src/renderer/src/ui-text.ts`:

```ts
sections: {
  profiles: "智能体",
  profileEditor: "角色配置",
  conversation: "协作消息",
  taskPlans: "任务计划",
  forwarding: "转发控制",
  terminals: "终端",
  runs: "运行记录",
},
```

- [ ] **Step 7: Run renderer tests and typecheck**

Run:

```powershell
cd desktop
npm test -- task-plan-layout.test.ts ui-text.test.ts workspace-layout.test.ts
npm run typecheck
```

Expected: PASS.

---

### Task 8: Final Verification And Legacy Boundary

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-05-04-agenthub-task-plan-manager-design.md`

- [ ] **Step 1: Update contributor guide task status**

Modify `AGENTS.md` task notes to state:

```md
- 当前主线将用“任务计划”替换旧“受控编排”和“任务看板”。
- 新任务计划使用 `TaskPlanStore`，不复用 legacy `TaskStore`。
- 旧 `TaskStore` 和 `OrchestrationService` 暂保留为历史兼容代码，不作为新流程入口。
```

- [ ] **Step 2: Run complete verification**

Run:

```powershell
cd desktop
npm run typecheck
npm test
npm run build
```

Expected:

```text
typecheck exits 0
34 or more test files pass
build exits 0
```

- [ ] **Step 3: Manual smoke**

Run the app:

```powershell
cd desktop
npm run dev
```

Manual checks:

```text
1. 协作消息 Tab 中显示“任务计划”面板。
2. 旧“受控编排”和旧“任务看板”不再显示。
3. 新建任务计划后出现日期和计划记录。
4. 点击计划能看到 task-plan.md 内容。
5. 点击“交给 Claude 管理”后 Claude 终端收到包含 plan_id 的 prompt。
6. Claude 输出 assign_task 后，Codex 终端收到带 plan/task 的任务。
```

---

## Self-Review

Spec coverage:

- Replaces old visible orchestration and task board UI: Task 7.
- New `TaskPlanStore`, no reuse of `TaskStore`: Task 1 and Task 8.
- Date/time plan directories: Task 1.
- `plan.json`, `task-plan.md`, `tasks.jsonl`, `events.jsonl`, `artifacts/`: Task 1.
- Claude manager prompt: Task 3.
- Codex/Gemini assignment and review commands: Task 2 and Task 3.
- Hook completion with plan metadata: Task 4 and Task 5.
- IPC and renderer access: Task 6 and Task 7.
- Failure handling baseline: Task 3, Task 4, Task 5.

Placeholder scan:

- No task contains unassigned implementation work.
- No section uses unresolved markers or open-ended wording.
- Every introduced type or method is defined in the task that first uses it.

Type consistency:

- Store uses `TaskPlan`, `TaskPlanTask`, `TaskPlanEvent`.
- IPC uses `TaskPlanDto`, `CreateTaskPlanRequest`, `TaskPlanActionRequest`.
- Service uses `TaskPlanSessionGateway` and consumes `AgentHubCommand` plan actions.
