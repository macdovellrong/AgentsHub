import { describe, expect, it } from "vitest";
import type { StartPowerShellResponse } from "../../shared/ipc";
import {
  buildProfileSavePayload,
  findOnlineSessionForTarget,
  pickSelectedSessionId,
  splitListInput,
} from "./dashboard-helpers";

const baseSession: StartPowerShellResponse = {
  sessionId: "session-1",
  runId: "run-1",
  profileId: "codex",
  profileName: "Codex",
  kind: "codex",
  workspacePath: "C:/work",
  status: "online",
  rawLogPath: "C:/work/.agenthub/runs/run-1/raw.log",
  metaPath: "C:/work/.agenthub/runs/run-1/meta.json",
};

describe("splitListInput", () => {
  it("splits whitespace and newline separated values", () => {
    expect(splitListInput("codex --dangerous\n--model gpt-5")).toEqual(["codex", "--dangerous", "--model", "gpt-5"]);
  });

  it("trims empty items", () => {
    expect(splitListInput("  @codex\n\n@coder  ")).toEqual(["@codex", "@coder"]);
  });
});

describe("buildProfileSavePayload", () => {
  it("keeps profile identity and parses args and aliases from simple text fields", () => {
    const payload = buildProfileSavePayload(
      {
        id: "custom",
        name: "Custom Agent",
        kind: "custom",
        command: "agent.exe",
        args: [],
        aliases: [],
        rolePrompt: "",
        env: { EXISTING: "1" },
        defaultCwd: null,
        useWorkspaceWriteLock: false,
      },
      {
        name: " Runner ",
        command: " tool.exe ",
        argsText: "run\n--json",
        aliasesText: "@runner r",
        rolePrompt: "Implement only.",
        useWorkspaceWriteLock: true,
      },
    );

    expect(payload).toEqual({
      kind: "custom",
      name: "Runner",
      command: "tool.exe",
      args: ["run", "--json"],
      aliases: ["@runner", "r"],
      rolePrompt: "Implement only.",
      env: { EXISTING: "1" },
      defaultCwd: null,
      useWorkspaceWriteLock: true,
    });
  });
});

describe("findOnlineSessionForTarget", () => {
  it("matches target profile ids and aliases", () => {
    const sessions = [baseSession];
    const profiles = [
      {
        id: "codex",
        name: "Codex",
        kind: "codex" as const,
        command: "codex",
        args: [],
        aliases: ["@coder"],
        rolePrompt: "",
        env: {},
        defaultCwd: null,
        useWorkspaceWriteLock: true,
      },
    ];

    expect(findOnlineSessionForTarget("@coder build this", sessions, profiles)?.sessionId).toBe("session-1");
    expect(findOnlineSessionForTarget("@codex build this", sessions, profiles)?.sessionId).toBe("session-1");
  });

  it("returns null when the target profile has no online session", () => {
    expect(findOnlineSessionForTarget("@codex build this", [{ ...baseSession, status: "exited" }], [])).toBeNull();
  });
});

describe("pickSelectedSessionId", () => {
  it("keeps the current selection when it is still active", () => {
    expect(pickSelectedSessionId("session-1", [baseSession])).toBe("session-1");
  });

  it("falls back to the first active session when the current selection is gone", () => {
    expect(pickSelectedSessionId("missing", [baseSession])).toBe("session-1");
  });

  it("returns null with no active sessions", () => {
    expect(pickSelectedSessionId("missing", [])).toBeNull();
  });
});
