import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureWorkspaceGitIgnore, mergeWorkspaceGitIgnore } from "./workspace-gitignore";

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("workspace gitignore", () => {
  it("creates a root .gitignore with AgentHub runtime directories", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-gitignore-"));

    await expect(ensureWorkspaceGitIgnore(workspacePath)).resolves.toBe(true);

    await expect(readFile(path.join(workspacePath, ".gitignore"), "utf8")).resolves.toBe(
      ".agenthub/\n.codex/\n.claude/\n.gemini/\n",
    );
  });

  it("appends missing AgentHub runtime directories without removing existing entries", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-gitignore-"));
    await writeFile(path.join(workspacePath, ".gitignore"), "node_modules/\n\n.env\n", "utf8");

    await expect(ensureWorkspaceGitIgnore(workspacePath)).resolves.toBe(true);

    await expect(readFile(path.join(workspacePath, ".gitignore"), "utf8")).resolves.toBe(
      "node_modules/\n\n.env\n.agenthub/\n.codex/\n.claude/\n.gemini/\n",
    );
  });

  it("does not rewrite when equivalent AgentHub entries already exist", () => {
    const raw = ".agenthub\n/.codex/\n.claude/**\n.gemini/*\n";

    expect(mergeWorkspaceGitIgnore(raw)).toBe(raw);
  });

  it("adds only missing entries", () => {
    expect(mergeWorkspaceGitIgnore(".agenthub/\n.codex/\n")).toBe(
      ".agenthub/\n.codex/\n.claude/\n.gemini/\n",
    );
  });
});
