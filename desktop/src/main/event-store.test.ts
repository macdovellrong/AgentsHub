import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventStore } from "./event-store";

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("EventStore", () => {
  it("appends and lists workspace events in order", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-events-"));
    const store = new EventStore();

    const first = await store.append(workspacePath, {
      type: "user_message",
      message: "Build backend",
      targetProfileId: "codex",
    });
    const second = await store.append(workspacePath, {
      type: "session_started",
      sessionId: "session-1",
      runId: "run-1",
      profileId: "codex",
      profileName: "Codex",
    });

    await expect(store.list(workspacePath)).resolves.toMatchObject([
      { id: first.id, type: "user_message", message: "Build backend" },
      { id: second.id, type: "session_started", sessionId: "session-1" },
    ]);
  });

  it("preserves conversation metadata when appending and listing events", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-events-"));
    const store = new EventStore();

    const appended = await store.append(workspacePath, {
      type: "agent_forward",
      message: "Please implement task 1",
      conversationId: "conversation-1",
      taskId: "task-1",
      parentEventId: "event-parent",
      targetProfileIds: ["codex", "gemini"],
      deliveryStatus: "pending",
    });

    await expect(store.list(workspacePath)).resolves.toMatchObject([
      {
        id: appended.id,
        type: "agent_forward",
        conversationId: "conversation-1",
        taskId: "task-1",
        parentEventId: "event-parent",
        targetProfileIds: ["codex", "gemini"],
        deliveryStatus: "pending",
      },
    ]);
  });

  it("keeps generated defaults when optional id and timestamp are undefined", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-events-"));
    const store = new EventStore();

    const appended = await store.append(workspacePath, {
      id: undefined,
      timestamp: undefined,
      type: "user_message",
      message: "hello",
    });

    expect(appended.id).toEqual(expect.any(String));
    expect(appended.timestamp).toEqual(expect.any(String));
    await expect(store.list(workspacePath)).resolves.toMatchObject([
      {
        id: appended.id,
        timestamp: appended.timestamp,
        message: "hello",
      },
    ]);
  });

  it("notifies when an event is appended", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-events-"));
    const notifications: Array<{ workspacePath: string; eventId: string }> = [];
    const store = new EventStore({
      onAppend: (workspace, event) => notifications.push({ workspacePath: workspace, eventId: event.id }),
    });

    const appended = await store.append(workspacePath, {
      type: "orchestration_step",
      conversationId: "conversation-1",
      message: "Forwarded task",
    });

    expect(notifications).toEqual([{ workspacePath, eventId: appended.id }]);
  });

  it("lists events when the jsonl file starts with a UTF-8 BOM", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-events-"));
    const eventPath = path.join(workspacePath, ".agenthub", "events.jsonl");
    await mkdir(path.dirname(eventPath), { recursive: true });
    const event = {
      id: "event-1",
      timestamp: "2026-05-01T00:00:00.000Z",
      type: "agent_output",
      message: "Claude result",
    };
    await writeFile(eventPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${JSON.stringify(event)}\n`)]));

    await expect(new EventStore().list(workspacePath)).resolves.toMatchObject([
      {
        id: "event-1",
        type: "agent_output",
        message: "Claude result",
      },
    ]);
  });

  it("skips malformed jsonl lines while listing later events", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-events-"));
    const eventPath = path.join(workspacePath, ".agenthub", "events.jsonl");
    await mkdir(path.dirname(eventPath), { recursive: true });
    await writeFile(
      eventPath,
      [
        JSON.stringify({
          id: "event-1",
          timestamp: "2026-05-01T00:00:00.000Z",
          type: "user_message",
          message: "ok",
        }),
        '{"id":"broken","message":"unterminated}',
        JSON.stringify({
          id: "event-2",
          timestamp: "2026-05-01T00:00:01.000Z",
          type: "agent_output",
          message: "still listed",
        }),
      ].join("\n"),
      "utf8",
    );

    await expect(new EventStore().list(workspacePath)).resolves.toMatchObject([
      { id: "event-1", message: "ok" },
      { id: "event-2", message: "still listed" },
    ]);
  });

  it("skips syntactically valid json records with invalid event shape", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-events-"));
    const eventPath = path.join(workspacePath, ".agenthub", "events.jsonl");
    await mkdir(path.dirname(eventPath), { recursive: true });
    await writeFile(
      eventPath,
      [
        JSON.stringify({ id: "missing-type", timestamp: "2026-05-01T00:00:00.000Z" }),
        JSON.stringify({ id: "bad-type", type: "unknown", timestamp: "2026-05-01T00:00:00.000Z" }),
        JSON.stringify(["not", "an", "event"]),
        JSON.stringify({
          id: "event-valid",
          timestamp: "2026-05-01T00:00:01.000Z",
          type: "agent_output",
          message: "valid",
        }),
      ].join("\n"),
      "utf8",
    );

    await expect(new EventStore().list(workspacePath)).resolves.toMatchObject([
      { id: "event-valid", message: "valid" },
    ]);
  });
});
