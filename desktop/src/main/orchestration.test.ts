import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventStore } from "./event-store";
import { OrchestrationService, type OrchestrationSessionGateway } from "./orchestration";
import { TaskStore } from "./task-store";

class FakeGateway implements OrchestrationSessionGateway {
  sessions: ReturnType<OrchestrationSessionGateway["listSessions"]> = [];
  writes: Array<{ sessionId: string; data: string }> = [];

  listSessions(): ReturnType<OrchestrationSessionGateway["listSessions"]> {
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

describe("OrchestrationService", () => {
  it("creates controlled tasks and sends one explicit prompt to the planner only", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-orchestration-"));
    const gateway = new FakeGateway();
    gateway.sessions = [
      { sessionId: "planner-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "implementer-session", profileId: "codex", workspacePath, status: "online" },
      { sessionId: "reviewer-session", profileId: "gemini", workspacePath, status: "online" },
    ];
    const service = new OrchestrationService(new TaskStore(), new EventStore(), gateway);

    const result = await service.start({
      workspacePath,
      goal: "Add forwarding API.",
      rolePrompts: { claude: "Break work into small steps." },
    });

    expect(result.tasks).toHaveLength(3);
    expect(gateway.writes).toHaveLength(1);
    expect(gateway.writes[0]).toMatchObject({ sessionId: "planner-session" });
    expect(gateway.writes[0].data).toContain("Role: planner");
    expect(gateway.writes[0].data).toContain("Profile instructions:");
    expect(gateway.writes[0].data).toContain("Break work into small steps.");
    const events = await new EventStore().list(workspacePath);
    expect(events.filter((event) => event.status === "waiting_previous_step")).toHaveLength(2);
  });

  it("records waiting_session events instead of throwing when a role profile is offline", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-orchestration-"));
    const eventStore = new EventStore();
    const gateway = new FakeGateway();
    const service = new OrchestrationService(new TaskStore(), eventStore, gateway);

    await service.start({
      workspacePath,
      goal: "Build tests.",
      implementerProfileId: "codex",
    });

    expect(gateway.writes).toEqual([]);
    const events = await eventStore.list(workspacePath);
    expect(events.filter((event) => event.status === "waiting_session")).toHaveLength(1);
    expect(events.filter((event) => event.status === "waiting_previous_step")).toHaveLength(2);
    expect(events.find((event) => event.profileId === "claude" && event.status === "waiting_session")).toBeDefined();
  });
});
