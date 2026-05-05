import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventStore, type AgentHubEvent } from "./event-store";
import { AgentResultHookReceiver } from "./hook-receiver";
import { TaskPlanService, type TaskPlanSession, type TaskPlanSessionGateway } from "./task-plan-service";
import { TaskPlanStore } from "./task-plan-store";

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

class FakeHookGateway implements TaskPlanSessionGateway {
  readonly writes: Array<{ sessionId: string; data: string }> = [];

  constructor(public sessions: TaskPlanSession[] = []) {}

  listSessions(): TaskPlanSession[] {
    return this.sessions;
  }

  write(sessionId: string, data: string): void {
    this.writes.push({ sessionId, data });
  }
}

describe("AgentResultHookReceiver", () => {
  it("rejects requests with an invalid token", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-hook-"));
    const receiver = new AgentResultHookReceiver({
      port: 0,
      token: "correct-token",
      eventStore: new EventStore(),
    });
    const info = await receiver.start();

    try {
      const response = await fetch(info.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentHub-Token": "wrong-token",
        },
        body: JSON.stringify({
          workspace: workspacePath,
          profileId: "codex",
          message: "done",
        }),
      });

      expect(response.status).toBe(401);
    } finally {
      await receiver.stop();
    }
  });

  it("writes valid hook results as agent output events and notifies listeners", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-hook-"));
    const eventStore = new EventStore();
    const notifications: Array<{ workspacePath: string; message: string | undefined }> = [];
    const receiver = new AgentResultHookReceiver({
      port: 0,
      token: "secret",
      eventStore,
      onEventAppended: (workspace, event) => {
        notifications.push({ workspacePath: workspace, message: event.message });
      },
    });
    const info = await receiver.start();

    try {
      const response = await fetch(info.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentHub-Token": "secret",
        },
        body: JSON.stringify({
          source: "codex",
          hookEvent: "Stop",
          profileId: "codex",
          agenthubSessionId: "session-1",
          runId: "run-1",
          workspace: workspacePath,
          providerSessionId: "provider-session",
          providerTurnId: "turn-1",
          model: "gpt-5.3-codex",
          cwd: workspacePath,
          message: "任务完成。",
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true });
      await expect(eventStore.list(workspacePath)).resolves.toMatchObject([
        {
          type: "agent_output",
          profileId: "codex",
          sessionId: "session-1",
          runId: "run-1",
          message: "任务完成。",
          metadata: {
            source: "codex",
            hookEvent: "Stop",
            providerSessionId: "provider-session",
            providerTurnId: "turn-1",
            model: "gpt-5.3-codex",
            cwd: workspacePath,
          },
        },
      ]);
      expect(notifications).toEqual([{ workspacePath, message: "任务完成。" }]);
    } finally {
      await receiver.stop();
    }
  });

  it("notifies listeners with compact metadata that omits undefined values", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-hook-"));
    const eventStore = new EventStore();
    const liveEvents: AgentHubEvent[] = [];
    const receiver = new AgentResultHookReceiver({
      port: 0,
      token: "secret",
      eventStore,
      onEventAppended: (_workspace, event) => {
        liveEvents.push(event);
      },
    });
    const info = await receiver.start();

    try {
      const response = await fetch(info.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentHub-Token": "secret",
        },
        body: JSON.stringify({
          source: "codex",
          profileId: "codex",
          workspace: workspacePath,
          message: "done",
        }),
      });

      expect(response.status).toBe(200);
      expect(liveEvents).toHaveLength(1);
      expect(Object.values(liveEvents[0].metadata ?? {})).not.toContain(undefined);
      expect(liveEvents[0].metadata).toEqual({ source: "codex" });
    } finally {
      await receiver.stop();
    }
  });

  it("preserves conversation metadata from hook payloads", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-hook-"));
    const eventStore = new EventStore();
    const receiver = new AgentResultHookReceiver({
      port: 0,
      token: "secret",
      eventStore,
    });
    const info = await receiver.start();

    try {
      const response = await fetch(info.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentHub-Token": "secret",
        },
        body: JSON.stringify({
          source: "codex",
          profileId: "codex",
          agenthubSessionId: "session-1",
          runId: "run-1",
          workspace: workspacePath,
          conversationId: "conversation-1",
          taskId: "T-001",
          message: "Task result",
        }),
      });

      expect(response.status).toBe(200);
      await expect(eventStore.list(workspacePath)).resolves.toMatchObject([
        {
          type: "agent_output",
          profileId: "codex",
          conversationId: "conversation-1",
          taskId: "T-001",
          message: "Task result",
        },
      ]);
    } finally {
      await receiver.stop();
    }
  });

  it("preserves task plan metadata from hook headers", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-hook-"));
    const eventStore = new EventStore();
    const receiver = new AgentResultHookReceiver({
      port: 0,
      token: "secret",
      eventStore,
    });
    const info = await receiver.start();

    try {
      const response = await fetch(info.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentHub-Token": "secret",
          "X-AgentHub-Plan-Id": "P001",
          "X-AgentHub-Task-Id": "T001",
        },
        body: JSON.stringify({
          source: "codex",
          profileId: "codex",
          agenthubSessionId: "codex-session",
          runId: "run-1",
          workspace: workspacePath,
          message: "Implemented task",
        }),
      });

      expect(response.status).toBe(200);
      await expect(eventStore.list(workspacePath)).resolves.toMatchObject([
        {
          type: "agent_output",
          profileId: "codex",
          taskId: "T001",
          message: "Implemented task",
          metadata: expect.objectContaining({ planId: "P001" }),
        },
      ]);
    } finally {
      await receiver.stop();
    }
  });

  it.each([
    ["planId", { planId: "P002" }],
    ["plan_id", { plan_id: "P003" }],
  ])("preserves task plan metadata from hook payload field %s", async (_fieldName, planPayload) => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-hook-"));
    const eventStore = new EventStore();
    const receiver = new AgentResultHookReceiver({
      port: 0,
      token: "secret",
      eventStore,
    });
    const info = await receiver.start();

    try {
      const response = await fetch(info.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentHub-Token": "secret",
        },
        body: JSON.stringify({
          source: "codex",
          profileId: "codex",
          workspace: workspacePath,
          taskId: "T002",
          message: "Payload task result",
          ...planPayload,
        }),
      });

      expect(response.status).toBe(200);
      const events = await eventStore.list(workspacePath);
      expect(events[0]).toMatchObject({
        type: "agent_output",
        profileId: "codex",
        taskId: "T002",
        metadata: expect.objectContaining({ planId: Object.values(planPayload)[0] }),
      });
    } finally {
      await receiver.stop();
    }
  });

  it("backfills task plan metadata from the latest sent forward and observes completion", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-hook-"));
    const eventStore = new EventStore();
    const taskPlanStore = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    const gateway = new FakeHookGateway([
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ]);
    const service = new TaskPlanService(taskPlanStore, eventStore, gateway);
    await mkdir(path.join(workspacePath, "tasks", "20260504-1330-hook-backfill"), { recursive: true });
    await writeFile(path.join(workspacePath, "tasks", "20260504-1330-hook-backfill", "task-plan.md"), "# Hook Backfill", "utf8");
    const plan = await service.createPlan(workspacePath, {
      title: "Hook Backfill",
      sourceTaskDirectoryName: "20260504-1330-hook-backfill",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    });
    await service.handleManagerCommand(workspacePath, "claude", {
      action: "assign_task",
      plan_id: plan.id,
      task_id: "T001",
      to: "codex",
      message: "Implement hook backfill",
    });
    let resolveObserved!: () => void;
    let rejectObserved!: (reason: unknown) => void;
    const observed = new Promise<void>((resolve, reject) => {
      resolveObserved = resolve;
      rejectObserved = reject;
    });
    const receiver = new AgentResultHookReceiver({
      port: 0,
      token: "secret",
      eventStore,
      onEventAppended: (workspace, event) => {
        service.handleAgentOutput(workspace, event).then(resolveObserved, rejectObserved);
      },
    });
    const info = await receiver.start();

    try {
      const response = await fetch(info.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentHub-Token": "secret",
        },
        body: JSON.stringify({
          source: "codex",
          profileId: "codex",
          agenthubSessionId: "codex-session",
          runId: "run-1",
          workspace: workspacePath,
          message: "Implemented via hook",
        }),
      });

      expect(response.status).toBe(200);
      await observed;
    } finally {
      await receiver.stop();
    }

    const events = await eventStore.list(workspacePath);
    expect(events.at(-2)).toMatchObject({
      type: "agent_output",
      profileId: "codex",
      sessionId: "codex-session",
      taskId: "T001",
      metadata: expect.objectContaining({ planId: plan.id }),
    });
    await expect(taskPlanStore.listEvents(workspacePath, plan.id)).resolves.toContainEqual(
      expect.objectContaining({
        type: "hook_completed",
        taskId: "T001",
        fromProfileId: "codex",
        toProfileId: "claude",
      }),
    );
    expect(gateway.writes).toHaveLength(2);
    expect(gateway.writes[1]).toMatchObject({ sessionId: "claude-session" });
    expect(gateway.writes[1].data).toContain("Implemented via hook");
  });

  it("preserves team metadata from hook payloads", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-hook-"));
    const eventStore = new EventStore();
    const receiver = new AgentResultHookReceiver({
      port: 0,
      token: "secret",
      eventStore,
    });
    const info = await receiver.start();

    try {
      const response = await fetch(info.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentHub-Token": "secret",
        },
        body: JSON.stringify({
          source: "claude",
          profileId: "claude",
          workspace: workspacePath,
          teamId: "default",
          message: "Team message",
        }),
      });

      expect(response.status).toBe(200);
      await expect(eventStore.list(workspacePath)).resolves.toMatchObject([
        {
          type: "agent_output",
          profileId: "claude",
          message: "Team message",
          metadata: { teamId: "default" },
        },
      ]);
    } finally {
      await receiver.stop();
    }
  });

  it("backfills missing conversation metadata from the latest sent forward for the target session", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-hook-"));
    const eventStore = new EventStore();
    await eventStore.append(workspacePath, {
      type: "agent_forward",
      conversationId: "conversation-1",
      taskId: "T-001",
      profileId: "claude",
      targetProfileId: "codex",
      targetProfileIds: ["codex"],
      sessionId: "codex-session",
      deliveryStatus: "sent",
      message: "Implement task",
    });
    const receiver = new AgentResultHookReceiver({
      port: 0,
      token: "secret",
      eventStore,
    });
    const info = await receiver.start();

    try {
      const response = await fetch(info.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentHub-Token": "secret",
        },
        body: JSON.stringify({
          source: "codex",
          profileId: "codex",
          agenthubSessionId: "codex-session",
          runId: "run-1",
          workspace: workspacePath,
          message: "Implemented task",
        }),
      });

      expect(response.status).toBe(200);
      await expect(eventStore.list(workspacePath)).resolves.toMatchObject([
        { type: "agent_forward", conversationId: "conversation-1", taskId: "T-001" },
        {
          type: "agent_output",
          profileId: "codex",
          sessionId: "codex-session",
          conversationId: "conversation-1",
          taskId: "T-001",
          message: "Implemented task",
        },
      ]);
    } finally {
      await receiver.stop();
    }
  });

  it("backfills pair negotiation metadata from the latest orchestration step for the target session", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-hook-"));
    const eventStore = new EventStore();
    await eventStore.append(workspacePath, {
      type: "orchestration_step",
      conversationId: "conversation-1",
      profileId: "claude",
      targetProfileId: "claude",
      targetProfileIds: ["claude"],
      sessionId: "claude-session",
      status: "running",
      message: "Pair negotiation started",
    });
    const receiver = new AgentResultHookReceiver({
      port: 0,
      token: "secret",
      eventStore,
    });
    const info = await receiver.start();

    try {
      const response = await fetch(info.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentHub-Token": "secret",
        },
        body: JSON.stringify({
          source: "claude",
          profileId: "claude",
          agenthubSessionId: "claude-session",
          runId: "run-1",
          workspace: workspacePath,
          message:
            '<agenthub>{"action":"continue","proposal_version":1,"summary":"Initial plan","message":"Please review."}</agenthub>',
        }),
      });

      expect(response.status).toBe(200);
      await expect(eventStore.list(workspacePath)).resolves.toMatchObject([
        { type: "orchestration_step", conversationId: "conversation-1" },
        {
          type: "agent_output",
          profileId: "claude",
          sessionId: "claude-session",
          conversationId: "conversation-1",
        },
      ]);
    } finally {
      await receiver.stop();
    }
  });

  it("backfills pair negotiation metadata from a sent forward without requiring a task id", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-hook-"));
    const eventStore = new EventStore();
    await eventStore.append(workspacePath, {
      type: "agent_forward",
      conversationId: "conversation-1",
      profileId: "claude",
      targetProfileId: "codex",
      targetProfileIds: ["codex"],
      sessionId: "codex-session",
      deliveryStatus: "sent",
      message: "Review the proposal",
    });
    const receiver = new AgentResultHookReceiver({
      port: 0,
      token: "secret",
      eventStore,
    });
    const info = await receiver.start();

    try {
      const response = await fetch(info.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentHub-Token": "secret",
        },
        body: JSON.stringify({
          source: "codex",
          profileId: "codex",
          agenthubSessionId: "codex-session",
          runId: "run-1",
          workspace: workspacePath,
          message:
            '<agenthub>{"action":"accept","proposal_version":1,"summary":"The proposal is acceptable."}</agenthub>',
        }),
      });

      expect(response.status).toBe(200);
      await expect(eventStore.list(workspacePath)).resolves.toMatchObject([
        { type: "agent_forward", conversationId: "conversation-1" },
        {
          type: "agent_output",
          profileId: "codex",
          sessionId: "codex-session",
          conversationId: "conversation-1",
          message:
            '<agenthub>{"action":"accept","proposal_version":1,"summary":"The proposal is acceptable."}</agenthub>',
        },
      ]);
    } finally {
      await receiver.stop();
    }
  });

  it("does not backfill old conversation metadata after a newer manual message to the same profile", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-hook-"));
    const eventStore = new EventStore();
    await eventStore.append(workspacePath, {
      type: "orchestration_step",
      conversationId: "conversation-1",
      profileId: "claude",
      targetProfileId: "claude",
      targetProfileIds: ["claude"],
      sessionId: "claude-session",
      status: "running",
      message: "Pair negotiation started",
      timestamp: "2026-05-03T01:00:00.000Z",
    });
    await eventStore.append(workspacePath, {
      type: "user_message",
      targetProfileId: "claude",
      message: "Manual message",
      timestamp: "2026-05-03T01:00:01.000Z",
    });
    const receiver = new AgentResultHookReceiver({
      port: 0,
      token: "secret",
      eventStore,
    });
    const info = await receiver.start();

    try {
      const response = await fetch(info.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentHub-Token": "secret",
        },
        body: JSON.stringify({
          source: "claude",
          profileId: "claude",
          agenthubSessionId: "claude-session",
          runId: "run-1",
          workspace: workspacePath,
          message: "Manual response",
        }),
      });

      expect(response.status).toBe(200);
      const events = await eventStore.list(workspacePath);
      expect(events).toMatchObject([
        { type: "orchestration_step", conversationId: "conversation-1" },
        { type: "user_message", targetProfileId: "claude" },
        {
          type: "agent_output",
          profileId: "claude",
          sessionId: "claude-session",
          message: "Manual response",
        },
      ]);
      expect(events.at(-1)).not.toHaveProperty("conversationId");
    } finally {
      await receiver.stop();
    }
  });

  it("accepts Claude HTTP hook payloads and extracts the latest assistant transcript message", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-hook-"));
    const transcriptPath = path.join(workspacePath, ".claude", "session.jsonl");
    await mkdir(path.dirname(transcriptPath), { recursive: true });
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "ping" },
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Claude final result" }],
          },
        }),
      ].join("\n"),
      "utf8",
    );
    const eventStore = new EventStore();
    const receiver = new AgentResultHookReceiver({
      port: 0,
      token: "secret",
      eventStore,
    });
    const info = await receiver.start();

    try {
      const response = await fetch(info.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentHub-Token": "secret",
          "X-AgentHub-Source": "claude",
          "X-AgentHub-Profile-Id": "claude",
          "X-AgentHub-Session-Id": "agenthub-session",
          "X-AgentHub-Run-Id": "run-1",
          "X-AgentHub-Workspace": workspacePath,
        },
        body: JSON.stringify({
          hook_event_name: "Stop",
          session_id: "claude-session",
          transcript_path: transcriptPath,
          cwd: workspacePath,
        }),
      });

      expect(response.status).toBe(200);
      await expect(eventStore.list(workspacePath)).resolves.toMatchObject([
        {
          type: "agent_output",
          profileId: "claude",
          sessionId: "agenthub-session",
          runId: "run-1",
          message: "Claude final result",
          metadata: {
            source: "claude",
            hookEvent: "Stop",
            providerSessionId: "claude-session",
            cwd: workspacePath,
          },
        },
      ]);
    } finally {
      await receiver.stop();
    }
  });
});
