import { describe, expect, it } from "vitest";
import type { StartPowerShellResponse } from "../../shared/ipc";
import {
  appendTerminalPreview,
  applyMentionSelection,
  buildRoutedTerminalMessage,
  buildProfileSavePayload,
  countOnlineSessionsForWorkspace,
  filterSessionsForWorkspace,
  findMentionQuery,
  getMentionCandidates,
  findOnlineSessionForProfile,
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

    expect(findOnlineSessionForTarget("@coder build this", sessions, profiles, "C:/work")?.sessionId).toBe("session-1");
    expect(findOnlineSessionForTarget("@codex build this", sessions, profiles, "C:/work")?.sessionId).toBe("session-1");
  });

  it("returns null when the target profile has no online session", () => {
    expect(findOnlineSessionForTarget("@codex build this", [{ ...baseSession, status: "exited" }], [])).toBeNull();
  });

  it("does not route to an online session in another workspace", () => {
    const sessions = [
      { ...baseSession, sessionId: "wrong-workspace", workspacePath: "C:/other" },
      { ...baseSession, sessionId: "right-workspace", workspacePath: "C:\\work\\" },
    ];
    const profiles = [
      {
        id: "codex",
        name: "Codex",
        kind: "codex" as const,
        command: "codex",
        args: [],
        aliases: [],
        rolePrompt: "",
        env: {},
        defaultCwd: null,
        useWorkspaceWriteLock: true,
      },
    ];

    expect(findOnlineSessionForTarget("@codex build this", sessions, profiles, "C:/work")?.sessionId).toBe("right-workspace");
    expect(findOnlineSessionForProfile("codex", sessions, "C:/missing")).toBeNull();
  });
});

describe("mention helpers", () => {
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
    {
      id: "gemini",
      name: "Gemini Reviewer",
      kind: "gemini" as const,
      command: "gemini",
      args: [],
      aliases: ["review"],
      rolePrompt: "",
      env: {},
      defaultCwd: null,
      useWorkspaceWriteLock: false,
    },
  ];

  it("finds the active mention query before the cursor", () => {
    expect(findMentionQuery("ask @co", 7)).toEqual({ start: 4, end: 7, query: "co" });
    expect(findMentionQuery("ask @co later", 13)).toBeNull();
  });

  it("matches mention candidates by id, name, and aliases", () => {
    expect(getMentionCandidates("co", profiles).map((profile) => profile.id)).toEqual(["codex"]);
    expect(getMentionCandidates("review", profiles).map((profile) => profile.id)).toEqual(["gemini"]);
  });

  it("replaces the current mention query with a profile token", () => {
    expect(applyMentionSelection("ask @co now", { start: 4, end: 7, query: "co" }, "codex")).toEqual({
      text: "ask @codex now",
      cursor: 11,
    });
  });
});

describe("workspace session helpers", () => {
  it("filters sessions to the active workspace", () => {
    const sessions = [
      baseSession,
      { ...baseSession, sessionId: "other", workspacePath: "C:/other" },
      { ...baseSession, sessionId: "exited", status: "exited" as const },
    ];

    expect(filterSessionsForWorkspace(sessions, "C:/work").map((session) => session.sessionId)).toEqual(["session-1"]);
    expect(countOnlineSessionsForWorkspace(sessions, "C:/work")).toBe(1);
  });
});

describe("appendTerminalPreview", () => {
  it("strips ANSI control sequences and normalizes carriage returns", () => {
    expect(appendTerminalPreview("", "\u001b[32mDone\u001b[0m\r\nNext\r")).toBe("Done\nNext\n");
  });

  it("keeps only the most recent preview text", () => {
    expect(appendTerminalPreview("abcdef", "ghij", 5)).toBe("fghij");
  });
});

describe("buildRoutedTerminalMessage", () => {
  it("sends only the routed user message without profile instruction wrappers", () => {
    expect(
      buildRoutedTerminalMessage(
        {
          id: "codex",
          name: "Codex",
          kind: "codex",
          command: "codex",
          args: [],
          aliases: [],
          rolePrompt: "Implement only focused changes.",
          env: {},
          defaultCwd: null,
          useWorkspaceWriteLock: true,
        },
        "Build the feature.",
      ),
    ).toBe("Build the feature.");
  });

  it("leaves routed messages unchanged when the profile has no role prompt", () => {
    expect(buildRoutedTerminalMessage(undefined, "dir")).toBe("dir");
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
