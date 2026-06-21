import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentTranscriptStore } from "./agent-transcript-store";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("AgentTranscriptStore", () => {
  it("records semantic terminal events outside raw.log", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agenthub-transcript-"));
    const store = new AgentTranscriptStore();

    const file = await store.append(tempDir, "run-1", {
      type: "terminal_output",
      sessionId: "s1",
      profileId: "codex",
      bytes: 5,
      preview: "hello",
    });

    const content = await readFile(file, "utf8");
    expect(content).toContain("\"type\":\"terminal_output\"");
    expect(content).toContain("\"profileId\":\"codex\"");
  });

  it("serializes multiple appends in order", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agenthub-transcript-"));
    const store = new AgentTranscriptStore();

    await Promise.all([
      store.append(tempDir, "run-1", { type: "terminal_input", sessionId: "s1", profileId: "codex", bytes: 1 }),
      store.append(tempDir, "run-1", { type: "terminal_output", sessionId: "s1", profileId: "codex", bytes: 2 }),
    ]);

    const content = await readFile(path.join(tempDir, ".agenthub", "runs", "run-1", "transcript.jsonl"), "utf8");
    expect(content.trim().split("\n")).toHaveLength(2);
  });
});
