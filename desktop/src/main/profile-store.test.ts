import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileStore } from "./profile-store";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("ProfileStore", () => {
  it("loads default agent profiles when no config exists", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agenthub-profiles-"));
    const store = new ProfileStore({ configPath: path.join(tempDir, "profiles.json") });

    const profiles = await store.list();

    expect(profiles.map((profile) => profile.id)).toEqual(["powershell", "codex", "claude", "gemini"]);
    expect(profiles.find((profile) => profile.id === "powershell")).toMatchObject({
      kind: "powershell",
      command: "powershell.exe",
      useWorkspaceWriteLock: false,
    });
    expect(profiles.find((profile) => profile.id === "codex")).toMatchObject({
      kind: "codex",
      command: "codex.cmd",
      useWorkspaceWriteLock: true,
    });
    expect(profiles.find((profile) => profile.id === "claude")).toMatchObject({
      kind: "claude",
      useWorkspaceWriteLock: false,
    });
    expect(profiles.find((profile) => profile.id === "gemini")).toMatchObject({
      kind: "gemini",
      command: "gemini.cmd",
    });
  });

  it("persists create, update, duplicate, and delete operations", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agenthub-profiles-"));
    const configPath = path.join(tempDir, "profiles.json");
    const store = new ProfileStore({ configPath });

    const created = await store.create({
      name: "Reviewer",
      kind: "custom",
      command: "review.exe",
      args: ["--strict"],
      aliases: ["review"],
      rolePrompt: "Review only.",
      env: { REVIEW_MODE: "1" },
      defaultCwd: "C:/work",
      useWorkspaceWriteLock: true,
    });
    const updated = await store.update(created.id, { name: "Reviewer 2", args: ["--fast"] });
    const duplicate = await store.duplicate(created.id, { id: "reviewer-copy", name: "Reviewer Copy" });
    await store.delete(created.id);

    expect(updated.name).toBe("Reviewer 2");
    expect(duplicate).toMatchObject({ id: "reviewer-copy", name: "Reviewer Copy", command: "review.exe" });

    const reloaded = new ProfileStore({ configPath });
    const profiles = await reloaded.list();
    expect(profiles.find((profile) => profile.id === created.id)).toBeUndefined();
    expect(profiles.find((profile) => profile.id === "reviewer-copy")).toMatchObject({
      aliases: ["review"],
      args: ["--fast"],
    });
    await expect(readFile(configPath, "utf8")).resolves.toContain("reviewer-copy");
  });

  it("migrates the legacy built-in Claude profile to read-only planning", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agenthub-profiles-"));
    const configPath = path.join(tempDir, "profiles.json");
    await writeFile(
      configPath,
      `${JSON.stringify({
        profiles: [
          {
            id: "claude",
            name: "Claude",
            kind: "claude",
            command: "claude",
            args: [],
            aliases: [],
            rolePrompt: "Plan and decompose implementation work.",
            env: {},
            defaultCwd: null,
            useWorkspaceWriteLock: true,
          },
        ],
      })}\n`,
      "utf8",
    );
    const store = new ProfileStore({ configPath });

    const profiles = await store.list();

    expect(profiles.find((profile) => profile.id === "claude")).toMatchObject({
      useWorkspaceWriteLock: false,
    });
  });
});
