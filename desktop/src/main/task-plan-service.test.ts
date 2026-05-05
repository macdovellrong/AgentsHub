import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventStore, type AgentHubEvent } from "./event-store";
import {
  observeHookEvent,
  TaskPlanService,
  type TaskPlanSession,
  type TaskPlanSessionGateway,
} from "./task-plan-service";
import { TaskPlanStore } from "./task-plan-store";

class FakeTaskPlanGateway implements TaskPlanSessionGateway {
  readonly writes: Array<{ sessionId: string; data: string }> = [];

  constructor(public sessions: TaskPlanSession[] = []) {}

  listSessions(): TaskPlanSession[] {
    return this.sessions;
  }

  write(sessionId: string, data: string): void {
    this.writes.push({ sessionId, data });
  }
}

let workspacePath: string | undefined;
let store: TaskPlanStore;
let eventStore: EventStore;
let gateway: FakeTaskPlanGateway;
let service: TaskPlanService;

beforeEach(async () => {
  workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-service-"));
  store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
  eventStore = new EventStore();
  gateway = new FakeTaskPlanGateway([
    { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
    { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    { sessionId: "gemini-session", profileId: "gemini", workspacePath, status: "online" },
  ]);
  service = new TaskPlanService(store, eventStore, gateway);
});

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("TaskPlanService", () => {
  it("starts the manager by sending Claude a plan-aware prompt", async () => {
    const plan = await createPlan();

    await service.startManager(workspacePath!, { planId: plan.id });

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.writes[0]).toMatchObject({ sessionId: "claude-session" });
    expect(gateway.writes[0].data).toContain(`Plan ID: ${plan.id}`);
    expect(gateway.writes[0].data).toContain(
      `Task source task-plan.md: ${path.join(workspacePath!, "tasks", "20260504-1330-task-plan-service", "task-plan.md")}`,
    );
    expect(gateway.writes[0].data).toContain(`Execution snapshot: ${path.join(plan.planPath, "task-plan.md")}`);
    expect(gateway.writes[0].data).toContain('"action":"assign_task"');
    expect(gateway.writes[0].data.endsWith("\r\n")).toBe(true);
    await expect(store.listEvents(workspacePath!, plan.id)).resolves.toMatchObject([
      { type: "manager_started", toProfileId: "claude", sessionId: "claude-session" },
    ]);
    await expect(eventStore.list(workspacePath!)).resolves.toMatchObject([
      {
        type: "orchestration_step",
        profileId: "claude",
        targetProfileId: "claude",
        status: "running",
        metadata: expect.objectContaining({ planId: plan.id }),
      },
    ]);
    await expect(store.getPlan(workspacePath!, plan.id)).resolves.toMatchObject({ status: "running" });
  });

  it("routes assign_task to Codex and records plan and global forward events", async () => {
    const plan = await createPlan();

    await service.handleManagerCommand(workspacePath!, "claude", {
      action: "assign_task",
      plan_id: plan.id,
      task_id: "T001",
      to: "codex",
      message: "Implement the parser",
    });

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.writes[0]).toMatchObject({ sessionId: "codex-session" });
    expect(gateway.writes[0].data).toContain(`Plan: ${plan.id}`);
    expect(gateway.writes[0].data).toContain("Task: T001");
    expect(gateway.writes[0].data).toContain("From: claude");
    expect(gateway.writes[0].data).toContain("Implement the parser");
    await expect(store.listTasks(workspacePath!, plan.id)).resolves.toMatchObject([
      {
        id: "T001",
        title: "T001",
        status: "running",
        assigneeProfileId: "codex",
        attempt: 1,
        description: "Implement the parser",
      },
    ]);
    await expect(store.listEvents(workspacePath!, plan.id)).resolves.toMatchObject([
      {
        type: "assigned",
        taskId: "T001",
        fromProfileId: "claude",
        toProfileId: "codex",
        sessionId: "codex-session",
      },
    ]);
    await expect(eventStore.list(workspacePath!)).resolves.toMatchObject([
      {
        type: "agent_forward",
        profileId: "claude",
        targetProfileId: "codex",
        taskId: "T001",
        sessionId: "codex-session",
        deliveryStatus: "sent",
        metadata: expect.objectContaining({
          planId: plan.id,
          agenthubCommand: expect.objectContaining({ action: "assign_task" }),
        }),
      },
    ]);
  });

  it("records delivery_failed instead of throwing when the target profile is offline", async () => {
    const plan = await createPlan();
    gateway.sessions = [{ sessionId: "claude-session", profileId: "claude", workspacePath: workspacePath!, status: "online" }];

    await service.handleManagerCommand(workspacePath!, "claude", {
      action: "assign_task",
      plan_id: plan.id,
      task_id: "T002",
      to: "codex",
      message: "Implement unavailable task",
    });

    expect(gateway.writes).toHaveLength(0);
    await expect(store.listEvents(workspacePath!, plan.id)).resolves.toMatchObject([
      {
        type: "delivery_failed",
        taskId: "T002",
        fromProfileId: "claude",
        toProfileId: "codex",
        message: "No online session for profile codex",
      },
    ]);
    await expect(eventStore.list(workspacePath!)).resolves.toMatchObject([
      {
        type: "agent_forward",
        targetProfileId: "codex",
        taskId: "T002",
        deliveryStatus: "failed",
        error: "No online session for profile codex",
      },
    ]);
  });

  it("writes hook completion artifacts, records review state, and notifies Claude", async () => {
    const plan = await createPlan();

    await service.handleHookCompletion(workspacePath!, {
      planId: plan.id,
      taskId: "T001",
      profileId: "codex",
      message: "Implementation finished",
      sessionId: "codex-session",
      runId: "run-1",
    });

    const tasks = await store.listTasks(workspacePath!, plan.id);
    expect(tasks).toMatchObject([
      {
        id: "T001",
        status: "review",
        assigneeProfileId: "codex",
        runId: "run-1",
        artifactPath: expect.stringMatching(/^artifacts\/T001-codex-run-1\.md$/),
      },
    ]);
    await expect(readFile(path.join(plan.planPath, tasks[0].artifactPath!), "utf8")).resolves.toBe(
      "Implementation finished",
    );
    await expect(store.listEvents(workspacePath!, plan.id)).resolves.toMatchObject([
      {
        type: "hook_completed",
        taskId: "T001",
        fromProfileId: "codex",
        toProfileId: "claude",
        artifactPath: tasks[0].artifactPath,
        runId: "run-1",
        sessionId: "codex-session",
      },
    ]);
    expect(gateway.writes).toHaveLength(1);
    expect(gateway.writes[0]).toMatchObject({ sessionId: "claude-session" });
    expect(gateway.writes[0].data).toContain("AgentHub delegated task completed observation.");
    expect(gateway.writes[0].data).toContain(
      "Review the artifact. Output approve_task if accepted; output reject_task with required fixes if changes are needed.",
    );
    expect(gateway.writes[0].data).toContain(tasks[0].artifactPath);
    expect(gateway.writes[0].data).toContain("approve_task");
    expect(gateway.writes[0].data).toContain("reject_task");
  });

  it("dispatches an assign_task command from Claude agent output", async () => {
    const plan = await createPlan();
    const event: AgentHubEvent = {
      id: "event-1",
      type: "agent_output",
      timestamp: "2026-05-04T13:30:13.000Z",
      profileId: "claude",
      message:
        '<agenthub>{"action":"assign_task","plan_id":"' +
        plan.id +
        '","task_id":"T003","to":"codex","message":"Implement from output"}</agenthub>',
    };

    await service.handleAgentOutput(workspacePath!, event);

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.writes[0]).toMatchObject({ sessionId: "codex-session" });
    await expect(store.listEvents(workspacePath!, plan.id)).resolves.toMatchObject([{ type: "assigned", taskId: "T003" }]);
  });

  it("observes hook agent_output metadata.planId/taskId and routes completion back to the manager", async () => {
    const plan = await createPlan();
    const event: AgentHubEvent = {
      id: "event-2",
      type: "agent_output",
      timestamp: "2026-05-04T13:30:14.000Z",
      profileId: "codex",
      sessionId: "codex-session",
      runId: "run-2",
      taskId: "T004",
      message: "Hook final output",
      metadata: { planId: plan.id },
    };

    await service.handleAgentOutput(workspacePath!, event);

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.writes[0]).toMatchObject({ sessionId: "claude-session" });
    expect(gateway.writes[0].data).toContain("Hook final output");
    await expect(store.listEvents(workspacePath!, plan.id)).resolves.toMatchObject([
      { type: "hook_completed", taskId: "T004", fromProfileId: "codex" },
    ]);
  });

  it("records unmatched_hook when task plan hook output is missing task metadata", async () => {
    const plan = await createPlan();
    const event: AgentHubEvent = {
      id: "event-unmatched",
      type: "agent_output",
      timestamp: "2026-05-04T13:30:14.000Z",
      profileId: "codex",
      sessionId: "codex-session",
      runId: "run-unmatched",
      message: "Hook output without task",
      metadata: { planId: plan.id },
    };

    await service.handleAgentOutput(workspacePath!, event);

    expect(gateway.writes).toHaveLength(0);
    await expect(store.listEvents(workspacePath!, plan.id)).resolves.toContainEqual(
      expect.objectContaining({
        type: "unmatched_hook",
        fromProfileId: "codex",
        sourceEventId: "event-unmatched",
        runId: "run-unmatched",
      }),
    );
    await expect(eventStore.list(workspacePath!)).resolves.toContainEqual(
      expect.objectContaining({
        type: "error",
        profileId: "codex",
        parentEventId: "event-unmatched",
        metadata: expect.objectContaining({ planId: plan.id }),
      }),
    );
  });

  it("ignores a duplicate hook agent_output event without writing another artifact or notifying Claude", async () => {
    const plan = await createPlan();
    const event: AgentHubEvent = {
      id: "event-duplicate",
      type: "agent_output",
      timestamp: "2026-05-04T13:30:14.000Z",
      profileId: "codex",
      sessionId: "codex-session",
      runId: "run-duplicate",
      taskId: "T005",
      message: "Duplicate hook output",
      metadata: { planId: plan.id },
    };

    await service.handleAgentOutput(workspacePath!, event);
    await service.handleAgentOutput(workspacePath!, event);

    expect(gateway.writes).toHaveLength(1);
    const events = await store.listEvents(workspacePath!, plan.id);
    expect(events.filter((candidate) => candidate.type === "hook_completed")).toMatchObject([
      {
        type: "hook_completed",
        taskId: "T005",
        fromProfileId: "codex",
        sourceEventId: "event-duplicate",
      },
    ]);
    expect((await store.listTasks(workspacePath!, plan.id)).filter((task) => task.id === "T005")).toHaveLength(1);
  });

  it("rejects task-plan manager commands from non-manager profiles without routing or changing tasks", async () => {
    const plan = await createPlan();
    const event: AgentHubEvent = {
      id: "event-unauthorized",
      type: "agent_output",
      timestamp: "2026-05-04T13:30:15.000Z",
      profileId: "codex",
      message:
        '<agenthub>{"action":"assign_task","plan_id":"' +
        plan.id +
        '","task_id":"T006","to":"gemini","message":"Unauthorized route"}</agenthub>',
    };

    await service.handleAgentOutput(workspacePath!, event);

    expect(gateway.writes).toHaveLength(0);
    await expect(store.listTasks(workspacePath!, plan.id)).resolves.toEqual([]);
    await expect(eventStore.list(workspacePath!)).resolves.toMatchObject([
      {
        type: "error",
        profileId: "codex",
        parentEventId: "event-unauthorized",
        error: `Profile codex is not the manager for task plan ${plan.id}`,
        metadata: expect.objectContaining({
          planId: plan.id,
          agenthubCommand: expect.objectContaining({ action: "assign_task" }),
        }),
      },
    ]);
  });

  it("keeps the assignment attempt when hook review and manager approval update task state", async () => {
    const plan = await createPlan();

    await service.handleManagerCommand(workspacePath!, "claude", {
      action: "assign_task",
      plan_id: plan.id,
      task_id: "T007",
      to: "codex",
      message: "Implement with stable attempts",
    });
    await service.handleHookCompletion(workspacePath!, {
      planId: plan.id,
      taskId: "T007",
      profileId: "codex",
      message: "Ready for review",
      runId: "run-attempt",
    });
    await service.handleManagerCommand(workspacePath!, "claude", {
      action: "approve_task",
      plan_id: plan.id,
      task_id: "T007",
      summary: "Accepted",
    });

    await expect(store.listTaskHistory(workspacePath!, plan.id)).resolves.toMatchObject([
      { id: "T007", status: "running", attempt: 1 },
      { id: "T007", status: "review", attempt: 1 },
      { id: "T007", status: "done", attempt: 1 },
    ]);
    await expect(store.listTasks(workspacePath!, plan.id)).resolves.toMatchObject([
      { id: "T007", status: "done", attempt: 1 },
    ]);
  });

  it("isolates hook observer failures and continues observers in order", async () => {
    const calls: string[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const event: AgentHubEvent = {
      id: "event-observers",
      type: "agent_output",
      timestamp: "2026-05-04T13:30:16.000Z",
      profileId: "codex",
      message: "observer test",
    };

    await observeHookEvent(workspacePath!, event, [
      ["task-plan", () => {
        calls.push("task-plan");
        throw new Error("task plan failed");
      }],
      ["team", () => {
        calls.push("team");
      }],
      ["conversation", async () => {
        calls.push("conversation");
      }],
    ]);

    expect(calls).toEqual(["task-plan", "team", "conversation"]);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("[agenthub:task-plan] hook observation failed"),
    );
    consoleError.mockRestore();
  });
});

async function createPlan() {
  await writeTaskSource(workspacePath!, "20260504-1330-task-plan-service", "# Task Plan\n\n- T001");
  return store.createPlan(workspacePath!, {
    title: "Task Plan Service",
    sourceTaskDirectoryName: "20260504-1330-task-plan-service",
    managerProfileId: "claude",
    participantProfileIds: ["codex", "gemini"],
  });
}

async function writeTaskSource(workspacePath: string, directoryName: string, markdown: string): Promise<void> {
  const taskDir = path.join(workspacePath, "tasks", directoryName);
  await mkdir(taskDir, { recursive: true });
  await writeFile(path.join(taskDir, "task-plan.md"), markdown, "utf8");
}
