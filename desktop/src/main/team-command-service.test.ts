import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventStore, type AgentHubEvent } from "./event-store";
import { TaskStore } from "./task-store";
import { TeamCommandService, type TeamCommandSessionGateway } from "./team-command-service";
import { TeamStore } from "./team-store";

class FakeGateway implements TeamCommandSessionGateway {
  sessions: ReturnType<TeamCommandSessionGateway["listSessions"]> = [];
  writes: Array<{ sessionId: string; data: string }> = [];

  listSessions(): ReturnType<TeamCommandSessionGateway["listSessions"]> {
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

describe("TeamCommandService", () => {
  it("routes send_message commands through the team mailbox to another online CLI", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-team-service-"));
    const eventStore = new EventStore();
    const teamStore = new TeamStore();
    const taskStore = new TaskStore();
    const gateway = new FakeGateway();
    gateway.sessions = [
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const service = new TeamCommandService(teamStore, taskStore, eventStore, gateway);
    const output = agentOutput({
      profileId: "claude",
      message:
        '<agenthub>{"action":"send_message","to":"codex","message":"Review this proposal.","team_id":"default","task_id":"T-001"}</agenthub>',
    });

    await service.handleAgentOutput(workspacePath, output);

    expect(gateway.writes).toEqual([
      {
        sessionId: "codex-session",
        data: expect.stringContaining("Review this proposal."),
      },
    ]);
    expect(gateway.writes[0]?.data).toContain("AgentHub team message.");
    expect(gateway.writes[0]?.data.endsWith("\r\n")).toBe(true);
    await expect(teamStore.listMailbox(workspacePath, "default")).resolves.toMatchObject([
      {
        action: "send_message",
        fromProfileId: "claude",
        toProfileId: "codex",
        taskId: "T-001",
        status: "sent",
        sessionId: "codex-session",
      },
    ]);
    await expect(eventStore.list(workspacePath)).resolves.toMatchObject([
      {
        type: "agent_forward",
        profileId: "claude",
        targetProfileId: "codex",
        taskId: "T-001",
        deliveryStatus: "sent",
        metadata: { teamId: "default" },
      },
    ]);
  });

  it("updates task board state from claim_task and complete_task commands", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-team-service-"));
    const eventStore = new EventStore();
    const teamStore = new TeamStore();
    const taskStore = new TaskStore();
    const task = await taskStore.create(workspacePath, {
      title: "Implement feature",
      description: "Add mailbox",
      status: "pending",
      profileId: null,
      runId: null,
    });
    const service = new TeamCommandService(teamStore, taskStore, eventStore, new FakeGateway());

    await service.handleAgentOutput(
      workspacePath,
      agentOutput({
        profileId: "codex",
        message: `<agenthub>{"action":"claim_task","task_id":"${task.id}","team_id":"default"}</agenthub>`,
      }),
    );
    await service.handleAgentOutput(
      workspacePath,
      agentOutput({
        profileId: "codex",
        message: `<agenthub>{"action":"complete_task","task_id":"${task.id}","summary":"Done with tests.","team_id":"default"}</agenthub>`,
      }),
    );

    await expect(taskStore.list(workspacePath)).resolves.toMatchObject([
      {
        id: task.id,
        status: "done",
        profileId: "codex",
      },
    ]);
    await expect(teamStore.listMailbox(workspacePath, "default")).resolves.toMatchObject([
      { action: "claim_task", fromProfileId: "codex", taskId: task.id, status: "observed" },
      { action: "complete_task", fromProfileId: "codex", taskId: task.id, status: "observed" },
    ]);
    await expect(eventStore.list(workspacePath)).resolves.toMatchObject([
      { type: "task_updated", profileId: "codex", taskId: task.id, status: "running" },
      { type: "task_updated", profileId: "codex", taskId: task.id, status: "done", message: "Done with tests." },
    ]);
  });
});

function agentOutput(input: Pick<AgentHubEvent, "profileId" | "message">): AgentHubEvent {
  return {
    id: randomUUID(),
    type: "agent_output",
    timestamp: new Date().toISOString(),
    ...input,
  };
}
