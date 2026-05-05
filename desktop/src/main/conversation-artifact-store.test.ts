import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationArtifactStore } from "./conversation-artifact-store";

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("ConversationArtifactStore", () => {
  it("initializes brief, memory, state, and turns directory", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-artifacts-"));
    const store = new ConversationArtifactStore();

    const result = await store.initializePairConversation(workspacePath, {
      conversationId: "conversation-1",
      topic: "Decide architecture",
      participantProfileIds: ["claude", "codex"],
      maxSteps: 6,
    });

    expect(result).toEqual({
      conversationRoot: ".agenthub/conversations/conversation-1",
      briefPath: ".agenthub/conversations/conversation-1/brief.md",
      memoryPath: ".agenthub/conversations/conversation-1/memory.md",
      statePath: ".agenthub/conversations/conversation-1/state.json",
      turnsPath: ".agenthub/conversations/conversation-1/turns",
    });
    await expect(readFile(path.join(workspacePath, result.briefPath), "utf8")).resolves.toContain(
      "Decide architecture",
    );
    await expect(readFile(path.join(workspacePath, result.memoryPath), "utf8")).resolves.toContain(
      "协商记忆",
    );
    await expect(readFile(path.join(workspacePath, result.statePath), "utf8")).resolves.toContain(
      '"conversationId": "conversation-1"',
    );
    expect((await stat(path.join(workspacePath, result.turnsPath))).isDirectory()).toBe(true);
  });

  it("rejects unsafe conversation ids when initializing artifacts", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-artifacts-"));
    const store = new ConversationArtifactStore();

    for (const conversationId of unsafeConversationIds) {
      await expect(
        store.initializePairConversation(workspacePath, {
          conversationId,
          topic: "Unsafe id",
          participantProfileIds: ["claude", "codex"],
          maxSteps: 6,
        }),
      ).rejects.toThrow("Unsafe conversation id");
    }
  });

  it("allocates stable numbered turn paths with safe profile ids", () => {
    const store = new ConversationArtifactStore();

    expect(store.turnArtifactPath("conversation-1", 1, "claude")).toBe(
      ".agenthub/conversations/conversation-1/turns/0001-claude.md",
    );
    expect(store.turnArtifactPath("conversation-1", 12, "codex.writer")).toBe(
      ".agenthub/conversations/conversation-1/turns/0012-codex-writer.md",
    );
  });

  it("rejects unsafe conversation ids when allocating turn paths", () => {
    const store = new ConversationArtifactStore();

    for (const conversationId of unsafeConversationIds) {
      expect(() => store.turnArtifactPath(conversationId, 1, "claude")).toThrow("Unsafe conversation id");
    }
  });

  it("validates existing turn artifacts and rejects unsafe paths", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-artifacts-"));
    const store = new ConversationArtifactStore();
    const artifactPath = ".agenthub/conversations/conversation-1/turns/0001-claude.md";
    await mkdir(path.dirname(path.join(workspacePath, artifactPath)), { recursive: true });
    await writeFile(path.join(workspacePath, artifactPath), "content", "utf8");

    await expect(store.validateTurnArtifactPath(workspacePath, "conversation-1", artifactPath)).resolves.toMatchObject({
      relativePath: artifactPath,
      absolutePath: path.resolve(workspacePath, artifactPath),
    });
    await expect(
      store.validateTurnArtifactPath(
        workspacePath,
        "conversation-1",
        ".agenthub/conversations/conversation-1/turns/../../outside.md",
      ),
    ).rejects.toThrow("Unsafe artifact path");
    await expect(
      store.validateTurnArtifactPath(workspacePath, "conversation-1", path.resolve(workspacePath, artifactPath)),
    ).rejects.toThrow("Unsafe artifact path");
    await expect(
      store.validateTurnArtifactPath(
        workspacePath,
        "conversation-1",
        ".agenthub/conversations/other/turns/0001-claude.md",
      ),
    ).rejects.toThrow("Artifact path must stay inside the conversation turns directory");
    await expect(
      store.validateTurnArtifactPath(
        workspacePath,
        "conversation-1",
        ".agenthub/conversations/conversation-1/turns/0002-claude.md",
      ),
    ).rejects.toThrow("Artifact file does not exist");
  });

  it("rejects unsafe conversation ids when validating turn artifacts", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-artifacts-"));
    const store = new ConversationArtifactStore();

    for (const conversationId of unsafeConversationIds) {
      await expect(
        store.validateTurnArtifactPath(
          workspacePath,
          conversationId,
          ".agenthub/conversations/conversation-1/turns/0001-claude.md",
        ),
      ).rejects.toThrow("Unsafe conversation id");
    }
  });
});

const unsafeConversationIds = ["../evil", "..\\evil", "nested/id", "C:/evil", ".", ".."];
