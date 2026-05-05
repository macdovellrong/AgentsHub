import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationStore } from "./conversation-store";

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("ConversationStore", () => {
  it("creates and persists a manager conversation with supervisor and participants", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversations-"));
    const store = new ConversationStore();

    const conversation = await store.create(workspacePath, {
      mode: "manager",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex", "gemini"],
      topic: "Coordinate implementation",
      currentStep: 0,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });

    expect(conversation).toMatchObject({
      mode: "manager",
      status: "running",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex", "gemini"],
      topic: "Coordinate implementation",
      currentStep: 0,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });

    await expect(store.list(workspacePath)).resolves.toMatchObject([
      {
        id: conversation.id,
        mode: "manager",
        supervisorProfileId: "claude",
        participantProfileIds: ["codex", "gemini"],
      },
    ]);

    const raw = await readFile(conversationLogPath(workspacePath), "utf8");
    expect(raw.trim().split(/\r?\n/)).toHaveLength(1);
  });

  it("creates and persists a pair negotiation conversation with two participants", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversations-"));
    const store = new ConversationStore();

    const conversation = await store.create(workspacePath, {
      mode: "pair_negotiation",
      supervisorProfileId: null,
      participantProfileIds: ["claude", "codex"],
      topic: "Agree on a rollout plan",
      maxSteps: 6,
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
    });

    expect(conversation).toMatchObject({
      mode: "pair_negotiation",
      status: "running",
      supervisorProfileId: null,
      participantProfileIds: ["claude", "codex"],
      topic: "Agree on a rollout plan",
      currentStep: 0,
      maxSteps: 6,
    });

    await expect(store.list(workspacePath)).resolves.toMatchObject([
      {
        id: conversation.id,
        mode: "pair_negotiation",
        participantProfileIds: ["claude", "codex"],
        maxSteps: 6,
      },
    ]);
  });

  it("updates status, currentStep, and updatedAt by appending a new record", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversations-"));
    const store = new ConversationStore();

    const conversation = await store.create(workspacePath, {
      mode: "manager",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex", "gemini"],
      topic: "Coordinate implementation",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    const updated = await store.update(workspacePath, conversation.id, {
      status: "paused",
      currentStep: 2,
      updatedAt: "2026-05-02T00:05:00.000Z",
    });

    expect(updated).toMatchObject({
      id: conversation.id,
      status: "paused",
      currentStep: 2,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:05:00.000Z",
    });

    await expect(store.list(workspacePath)).resolves.toMatchObject([
      {
        id: conversation.id,
        status: "paused",
        currentStep: 2,
        updatedAt: "2026-05-02T00:05:00.000Z",
      },
    ]);

    const raw = await readFile(conversationLogPath(workspacePath), "utf8");
    const records = raw
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as { id: string; status: string; currentStep: number });
    expect(records).toMatchObject([
      { id: conversation.id, status: "running", currentStep: 0 },
      { id: conversation.id, status: "paused", currentStep: 2 },
    ]);
  });

  it("lists latest records sorted by updatedAt descending", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversations-"));
    const conversationsPath = conversationLogPath(workspacePath);
    await mkdir(path.dirname(conversationsPath), { recursive: true });
    await writeFile(
      conversationsPath,
      [
        JSON.stringify({
          id: "conversation-old",
          mode: "roundtable",
          status: "running",
          supervisorProfileId: null,
          participantProfileIds: ["claude", "codex"],
          topic: "Earlier discussion",
          currentStep: 0,
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:01:00.000Z",
        }),
        JSON.stringify({
          id: "conversation-new",
          mode: "manager",
          status: "running",
          supervisorProfileId: "claude",
          participantProfileIds: ["codex", "gemini"],
          topic: "Latest manager work",
          currentStep: 0,
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:04:00.000Z",
        }),
        JSON.stringify({
          id: "conversation-old",
          mode: "roundtable",
          status: "completed",
          supervisorProfileId: null,
          participantProfileIds: ["claude", "codex"],
          topic: "Earlier discussion",
          currentStep: 3,
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:06:00.000Z",
        }),
      ].join("\n"),
      "utf8",
    );

    await expect(new ConversationStore().list(workspacePath)).resolves.toMatchObject([
      { id: "conversation-old", status: "completed", updatedAt: "2026-05-02T00:06:00.000Z" },
      { id: "conversation-new", status: "running", updatedAt: "2026-05-02T00:04:00.000Z" },
    ]);
  });

  it("returns an empty list when the conversation log does not exist", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversations-"));

    await expect(new ConversationStore().list(workspacePath)).resolves.toEqual([]);
  });

  it("skips malformed or invalid jsonl records while listing later conversations", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversations-"));
    const conversationsPath = conversationLogPath(workspacePath);
    await mkdir(path.dirname(conversationsPath), { recursive: true });
    await writeFile(
      conversationsPath,
      [
        '{"id":"broken","mode":"manager",',
        JSON.stringify({
          id: "invalid-shape",
          mode: "manager",
          status: "running",
          participantProfileIds: "codex",
          topic: "bad record",
          currentStep: 0,
          maxSteps: null,
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
        JSON.stringify({
          id: "conversation-valid",
          mode: "manager",
          status: "running",
          supervisorProfileId: "claude",
          participantProfileIds: ["codex"],
          topic: "valid record",
          currentStep: 0,
          maxSteps: null,
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:01:00.000Z",
        }),
      ].join("\n"),
      "utf8",
    );

    await expect(new ConversationStore().list(workspacePath)).resolves.toMatchObject([
      { id: "conversation-valid", topic: "valid record" },
    ]);
  });

  it("rejects duplicate caller-provided conversation ids", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversations-"));
    const store = new ConversationStore();

    await store.create(workspacePath, {
      id: "conversation-1",
      mode: "manager",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex"],
      topic: "first",
    });

    await expect(
      store.create(workspacePath, {
        id: "conversation-1",
        mode: "roundtable",
        participantProfileIds: ["gemini"],
        topic: "duplicate",
      }),
    ).rejects.toThrow("Conversation already exists: conversation-1");
  });

  it("rejects invalid create input before writing records", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversations-"));
    const store = new ConversationStore();

    await expect(
      store.create(workspacePath, {
        mode: "manager",
        supervisorProfileId: "claude",
        participantProfileIds: "codex",
        topic: "bad input",
      } as never),
    ).rejects.toThrow("Invalid conversation");

    await expect(store.list(workspacePath)).resolves.toEqual([]);
  });

  it("rejects invalid update input before writing records", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversations-"));
    const store = new ConversationStore();
    const conversation = await store.create(workspacePath, {
      mode: "manager",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex"],
      topic: "valid",
    });

    await expect(
      store.update(workspacePath, conversation.id, {
        currentStep: Number.NaN,
      }),
    ).rejects.toThrow("Invalid conversation");

    await expect(store.list(workspacePath)).resolves.toMatchObject([{ id: conversation.id, currentStep: 0 }]);
  });

  it("serializes concurrent updates so later patches keep earlier fields", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversations-"));
    const store = new ConversationStore();
    const conversation = await store.create(workspacePath, {
      mode: "manager",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex"],
      topic: "coordinate",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });

    await Promise.all([
      store.update(workspacePath, conversation.id, {
        status: "paused",
        updatedAt: "2026-05-02T00:01:00.000Z",
      }),
      store.update(workspacePath, conversation.id, {
        currentStep: 3,
        updatedAt: "2026-05-02T00:02:00.000Z",
      }),
    ]);

    await expect(store.list(workspacePath)).resolves.toMatchObject([
      {
        id: conversation.id,
        status: "paused",
        currentStep: 3,
      },
    ]);
  });
});

function conversationLogPath(workspacePath: string): string {
  return path.join(workspacePath, ".agenthub", "conversations", "conversations.jsonl");
}
