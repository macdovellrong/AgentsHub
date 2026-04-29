import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventStore } from "./event-store";
import { ForwardService, type ForwardSessionGateway } from "./forward-service";
import { ForwardStore } from "./forward-store";

class FakeGateway implements ForwardSessionGateway {
  sessions: ReturnType<ForwardSessionGateway["listSessions"]> = [];
  writes: Array<{ sessionId: string; data: string }> = [];

  listSessions(): ReturnType<ForwardSessionGateway["listSessions"]> {
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

describe("ForwardService", () => {
  it("sends a pending forward to the matching online target profile", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-forward-service-"));
    const gateway = new FakeGateway();
    gateway.sessions = [
      { sessionId: "session-1", profileId: "codex", workspacePath, status: "online" },
    ];
    const eventStore = new EventStore();
    const service = new ForwardService(new ForwardStore(), eventStore, gateway);
    const forward = await service.create(workspacePath, {
      sourceProfileId: "claude",
      targetProfileId: "codex",
      message: "Please implement task A.",
    });

    const sent = await service.send(workspacePath, forward.id);

    expect(sent.status).toBe("sent");
    expect(sent.sessionId).toBe("session-1");
    expect(gateway.writes).toEqual([
      {
        sessionId: "session-1",
        data: "Please implement task A.\r",
      },
    ]);
    await expect(eventStore.list(workspacePath)).resolves.toMatchObject([
      { type: "agent_forward", status: "pending", targetProfileId: "codex" },
      { type: "agent_forward", status: "sent", targetProfileId: "codex", sessionId: "session-1" },
    ]);
  });

  it("keeps a forward blocked when no matching target session is online", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-forward-service-"));
    const gateway = new FakeGateway();
    const eventStore = new EventStore();
    const service = new ForwardService(new ForwardStore(), eventStore, gateway);
    const forward = await service.create(workspacePath, {
      targetProfileId: "gemini",
      message: "Review this change.",
    });

    const blocked = await service.send(workspacePath, forward.id);

    expect(blocked.status).toBe("blocked");
    expect(blocked.lastError).toBe("No online session for profile gemini");
    expect(gateway.writes).toEqual([]);
    await expect(eventStore.list(workspacePath)).resolves.toMatchObject([
      { type: "agent_forward", status: "pending", targetProfileId: "gemini" },
      { type: "agent_forward", status: "blocked", targetProfileId: "gemini" },
    ]);
  });

  it("pauses, resumes, and stops a forward without losing the record", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-forward-service-"));
    const gateway = new FakeGateway();
    gateway.sessions = [
      { sessionId: "session-2", profileId: "codex", workspacePath, status: "online" },
    ];
    const service = new ForwardService(new ForwardStore(), new EventStore(), gateway);
    const forward = await service.create(workspacePath, {
      targetProfileId: "codex",
      message: "Continue.",
    });

    const paused = await service.pause(workspacePath, forward.id);
    const resumed = await service.send(workspacePath, paused.id);
    const stopped = await service.stop(workspacePath, resumed.id);

    expect(paused.status).toBe("paused");
    expect(resumed.status).toBe("sent");
    expect(stopped.status).toBe("stopped");
    expect(await service.list(workspacePath)).toMatchObject([{ id: forward.id, status: "stopped" }]);
  });
});
