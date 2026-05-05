import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceStore } from "./workspace-store";

let configRoot: string | undefined;

function createStore(now = "2026-04-29T00:00:00.000Z"): WorkspaceStore {
  if (!configRoot) {
    throw new Error("configRoot is not initialized");
  }
  return new WorkspaceStore({
    configPath: path.join(configRoot, "workspaces.json"),
    now: () => new Date(now),
  });
}

afterEach(async () => {
  if (configRoot) {
    await rm(configRoot, { recursive: true, force: true });
    configRoot = undefined;
  }
});

describe("WorkspaceStore", () => {
  it("initializes with the default workspace and marks it active", async () => {
    configRoot = await mkdtemp(path.join(tmpdir(), "agenthub-workspaces-"));
    const store = createStore();

    await expect(store.initialize("C:\\work\\AgentGroup")).resolves.toEqual({
      activeWorkspacePath: "C:\\work\\AgentGroup",
      workspaces: [
        {
          path: "C:\\work\\AgentGroup",
          name: "AgentGroup",
          lastOpenedAt: "2026-04-29T00:00:00.000Z",
          isActive: true,
        },
      ],
    });
  });

  it("adds workspaces once and keeps the most recent entry first", async () => {
    configRoot = await mkdtemp(path.join(tmpdir(), "agenthub-workspaces-"));
    const firstStore = createStore("2026-04-29T00:00:00.000Z");
    await firstStore.initialize("C:\\work\\AgentGroup");

    const secondStore = createStore("2026-04-29T01:00:00.000Z");
    const state = await secondStore.activate("C:\\work\\openClashRule");

    expect(state.workspaces.map((workspace) => workspace.path)).toEqual([
      "C:\\work\\openClashRule",
      "C:\\work\\AgentGroup",
    ]);
    expect(state.workspaces[0]).toMatchObject({
      name: "openClashRule",
      isActive: true,
      lastOpenedAt: "2026-04-29T01:00:00.000Z",
    });
  });

  it("activates an existing workspace without moving it to the top", async () => {
    configRoot = await mkdtemp(path.join(tmpdir(), "agenthub-workspaces-"));
    const store = createStore("2026-04-29T00:00:00.000Z");
    await store.initialize("C:\\work\\AgentGroup");
    await createStore("2026-04-29T01:00:00.000Z").activate("C:\\work\\openClashRule");

    const state = await createStore("2026-04-29T02:00:00.000Z").activate("C:\\work\\AgentGroup");

    expect(state.activeWorkspacePath).toBe("C:\\work\\AgentGroup");
    expect(state.workspaces.map((workspace) => workspace.path)).toEqual([
      "C:\\work\\openClashRule",
      "C:\\work\\AgentGroup",
    ]);
    expect(state.workspaces).toMatchObject([
      { path: "C:\\work\\openClashRule", isActive: false, lastOpenedAt: "2026-04-29T01:00:00.000Z" },
      { path: "C:\\work\\AgentGroup", isActive: true, lastOpenedAt: "2026-04-29T00:00:00.000Z" },
    ]);
  });

  it("keeps workspace order when listing initializes after switching active workspace", async () => {
    configRoot = await mkdtemp(path.join(tmpdir(), "agenthub-workspaces-"));
    const store = createStore("2026-04-29T00:00:00.000Z");
    await store.initialize("C:\\work\\AgentGroup");
    await createStore("2026-04-29T01:00:00.000Z").activate("C:\\work\\openClashRule");
    await createStore("2026-04-29T02:00:00.000Z").activate("C:\\work\\AgentGroup");

    const state = await createStore("2026-04-29T03:00:00.000Z").initialize("C:\\work\\AgentGroup");

    expect(state.workspaces.map((workspace) => workspace.path)).toEqual([
      "C:\\work\\openClashRule",
      "C:\\work\\AgentGroup",
    ]);
    expect(state.workspaces).toMatchObject([
      { path: "C:\\work\\openClashRule", isActive: false, lastOpenedAt: "2026-04-29T01:00:00.000Z" },
      { path: "C:\\work\\AgentGroup", isActive: true, lastOpenedAt: "2026-04-29T00:00:00.000Z" },
    ]);
  });

  it("removes a non-active workspace from the remembered list", async () => {
    configRoot = await mkdtemp(path.join(tmpdir(), "agenthub-workspaces-"));
    const store = createStore("2026-04-29T00:00:00.000Z");
    await store.initialize("C:\\work\\AgentGroup");
    await createStore("2026-04-29T01:00:00.000Z").activate("C:\\work\\openClashRule");

    const state = await store.remove("C:\\work\\AgentGroup", "C:\\work\\openClashRule");

    expect(state.activeWorkspacePath).toBe("C:\\work\\openClashRule");
    expect(state.workspaces.map((workspace) => workspace.path)).toEqual(["C:\\work\\openClashRule"]);
  });

  it("rejects removing the active workspace", async () => {
    configRoot = await mkdtemp(path.join(tmpdir(), "agenthub-workspaces-"));
    const store = createStore();
    await store.initialize("C:\\work\\AgentGroup");

    await expect(store.remove("C:\\work\\AgentGroup", "C:\\work\\AgentGroup")).rejects.toThrow(
      "Cannot remove the active workspace",
    );
  });

  it("deduplicates equivalent paths case-insensitively", async () => {
    configRoot = await mkdtemp(path.join(tmpdir(), "agenthub-workspaces-"));
    const store = createStore();

    await store.initialize("C:\\work\\AgentGroup");
    await store.activate("c:\\work\\agentgroup\\");

    const state = await store.list("C:\\work\\AgentGroup");

    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ path: "C:\\work\\AgentGroup", isActive: true });
  });

  it("persists the active workspace path", async () => {
    configRoot = await mkdtemp(path.join(tmpdir(), "agenthub-workspaces-"));
    const store = createStore();

    await store.initialize("C:\\work\\AgentGroup");
    await store.activate("D:\\tools");

    const raw = JSON.parse(await readFile(path.join(configRoot, "workspaces.json"), "utf8")) as {
      activeWorkspacePath: string;
    };
    expect(raw.activeWorkspacePath).toBe("D:\\tools");
  });

  it("recovers from a malformed workspace config", async () => {
    configRoot = await mkdtemp(path.join(tmpdir(), "agenthub-workspaces-"));
    await writeFile(path.join(configRoot, "workspaces.json"), "{", "utf8");
    const store = createStore();

    await expect(store.initialize("C:\\work\\AgentGroup")).resolves.toMatchObject({
      activeWorkspacePath: "C:\\work\\AgentGroup",
      workspaces: [{ path: "C:\\work\\AgentGroup", isActive: true }],
    });
  });
});
