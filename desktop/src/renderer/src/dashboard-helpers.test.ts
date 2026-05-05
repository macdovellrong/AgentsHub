import { describe, expect, it } from "vitest";
import type { AgentConversationDto, AgentHubEventDto, StartPowerShellResponse } from "../../shared/ipc";
import {
  appendTerminalPreview,
  applyMentionSelection,
  buildTaskPlanGenerationPrompt,
  buildQuotedForwardMessage,
  buildRoutedTerminalMessage,
  buildTerminalSubmitInput,
  buildProfileSavePayload,
  countOnlineSessionsForWorkspace,
  describeConversationEvent,
  filterActiveConversations,
  filterConversationEvents,
  formatConversationModeLabel,
  formatConversationStatusLabel,
  formatParticipantLabel,
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

describe("filterConversationEvents", () => {
  const baseEvent: Omit<AgentHubEventDto, "id" | "type"> = {
    timestamp: "2026-05-01T00:00:00.000Z",
  };

  it("keeps collaborative messages and hides session lifecycle noise", () => {
    const events: AgentHubEventDto[] = [
      { ...baseEvent, id: "event-1", type: "session_started", profileName: "Codex" },
      { ...baseEvent, id: "event-2", type: "user_message", message: "Build this" },
      { ...baseEvent, id: "event-3", type: "agent_output", profileName: "Gemini", message: "Reviewed" },
      { ...baseEvent, id: "event-4", type: "session_exited", profileName: "Gemini" },
      { ...baseEvent, id: "event-5", type: "agent_forward", message: "Forward sent" },
      { ...baseEvent, id: "event-6", type: "error", message: "Target offline" },
    ];

    expect(filterConversationEvents(events).map((event) => event.id)).toEqual([
      "event-2",
      "event-3",
      "event-6",
    ]);
  });
});

describe("describeConversationEvent", () => {
  it("returns the message for ordinary events", () => {
    const event: AgentHubEventDto = {
      id: "event-message",
      type: "agent_output",
      timestamp: "2026-05-03T00:00:00.000Z",
      profileName: "codex",
      message: "Implementation complete.",
    };

    expect(describeConversationEvent(event)).toBe("Implementation complete.");
  });

  it("summarizes artifact-backed agent output without showing the raw command", () => {
    const event: AgentHubEventDto = {
      id: "event-artifact",
      type: "agent_output",
      timestamp: "2026-05-03T00:00:00.000Z",
      conversationId: "c1",
      profileName: "claude",
      message:
        '<agenthub>{"command":"done","artifact_path":".agenthub/conversations/c1/turns/0001-claude.md","summary":"Stored plan"}</agenthub>',
      metadata: {
        agenthubCommand: {
          artifact_path: ".agenthub/conversations/c1/turns/0001-claude.md",
          summary: "Stored plan",
        },
      },
    };

    const description = describeConversationEvent(event);

    expect(description).toBe("claude 已写入 .agenthub/conversations/c1/turns/0001-claude.md：Stored plan");
    expect(description).not.toContain("<agenthub>");
  });

  it("summarizes hook-style artifact commands from the message when metadata is empty", () => {
    const event: AgentHubEventDto = {
      id: "event-hook-artifact",
      type: "agent_output",
      timestamp: "2026-05-03T00:00:00.000Z",
      conversationId: "c1",
      profileName: "claude",
      message:
        '<agenthub>{"action":"continue","proposal_version":1,"artifact_path":".agenthub/conversations/c1/turns/0001-claude.md","summary":"Stored plan"}</agenthub>',
      metadata: {},
    };

    const description = describeConversationEvent(event);

    expect(description).toBe("claude 已写入 .agenthub/conversations/c1/turns/0001-claude.md：Stored plan");
    expect(description).not.toContain("<agenthub>");
  });

  it("summarizes artifact commands from mixed message text without showing control JSON", () => {
    const event: AgentHubEventDto = {
      id: "event-mixed-artifact",
      type: "agent_output",
      timestamp: "2026-05-03T00:00:00.000Z",
      conversationId: "c1",
      profileName: "claude",
      message:
        'Plan stored.\n<agenthub>{"action":"continue","artifact_path":".agenthub/conversations/c1/turns/0001-claude.md","summary":"Stored plan"}</agenthub>',
      metadata: {},
    };

    const description = describeConversationEvent(event);

    expect(description).toBe("claude 已写入 .agenthub/conversations/c1/turns/0001-claude.md：Stored plan");
    expect(description).not.toContain("<agenthub>");
    expect(description).not.toContain('"artifact_path"');
  });

  it("falls back to the message for non-artifact or invalid agenthub commands", () => {
    const baseEvent: AgentHubEventDto = {
      id: "event-invalid-command",
      type: "agent_output",
      timestamp: "2026-05-03T00:00:00.000Z",
      profileName: "gemini",
      message: "Reviewed the plan.",
    };

    expect(
      describeConversationEvent({
        ...baseEvent,
        metadata: { agenthubCommand: { command: "send", summary: "No artifact path" } },
      }),
    ).toBe("Reviewed the plan.");
    expect(
      describeConversationEvent({
        ...baseEvent,
        metadata: { agenthubCommand: "not-an-object" },
      }),
    ).toBe("Reviewed the plan.");
  });
});

describe("conversation helpers", () => {
  const baseConversation: AgentConversationDto = {
    id: "conversation-1",
    mode: "manager",
    status: "running",
    supervisorProfileId: "claude",
    participantProfileIds: ["codex", "gemini"],
    topic: "Build the manager controls",
    currentStep: 1,
    maxSteps: 12,
    createdAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T00:02:00.000Z",
  };

  it("formats conversation status labels in Chinese", () => {
    expect(formatConversationStatusLabel("running")).toBe("运行中");
    expect(formatConversationStatusLabel("paused")).toBe("已暂停");
    expect(formatConversationStatusLabel("completed")).toBe("已完成");
    expect(formatConversationStatusLabel("failed")).toBe("失败");
    expect(formatConversationStatusLabel("stopped")).toBe("已停止");
  });

  it("formats conversation mode labels in Chinese", () => {
    expect(formatConversationModeLabel("pair_negotiation")).toBe("协商");
    expect(formatConversationModeLabel("manager")).toBe("管理");
    expect(formatConversationModeLabel("roundtable")).toBe("讨论");
  });

  it("builds compact participant labels with the supervisor first", () => {
    expect(formatParticipantLabel(baseConversation)).toBe("claude -> codex, gemini");
    expect(formatParticipantLabel({ ...baseConversation, supervisorProfileId: null, participantProfileIds: ["codex"] })).toBe(
      "codex",
    );
  });

  it("keeps active conversations sorted by latest update", () => {
    const conversations: AgentConversationDto[] = [
      { ...baseConversation, id: "completed", status: "completed", updatedAt: "2026-05-02T00:06:00.000Z" },
      { ...baseConversation, id: "old-running", status: "running", updatedAt: "2026-05-02T00:01:00.000Z" },
      { ...baseConversation, id: "paused", status: "paused", updatedAt: "2026-05-02T00:05:00.000Z" },
      { ...baseConversation, id: "failed", status: "failed", updatedAt: "2026-05-02T00:04:00.000Z" },
    ];

    expect(filterActiveConversations(conversations).map((conversation) => conversation.id)).toEqual([
      "paused",
      "old-running",
    ]);
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

describe("buildTerminalSubmitInput", () => {
  it("uses CRLF when submitting routed messages to Gemini", () => {
    expect(
      buildTerminalSubmitInput(
        {
          id: "gemini",
          name: "Gemini",
          kind: "gemini",
          command: "gemini.cmd",
          args: [],
          aliases: [],
          rolePrompt: "",
          env: {},
          defaultCwd: null,
          useWorkspaceWriteLock: false,
        },
        "Review this",
      ),
    ).toBe("Review this\r\n");
  });

  it("uses CRLF when submitting routed messages to non-Gemini profiles", () => {
    expect(
      buildTerminalSubmitInput(
        {
          id: "codex",
          name: "Codex",
          kind: "codex",
          command: "codex.cmd",
          args: [],
          aliases: [],
          rolePrompt: "",
          env: {},
          defaultCwd: null,
          useWorkspaceWriteLock: true,
        },
        "Implement this",
      ),
    ).toBe("Implement this\r\n");
  });
});

describe("buildTaskPlanGenerationPrompt", () => {
  it("wraps a task request in instructions for creating a tasks directory task-plan", () => {
    const prompt = buildTaskPlanGenerationPrompt("实现多任务目录管理");

    expect(prompt).toContain("你是 AgentHub 的任务计划生成器。");
    expect(prompt).toContain("tasks/YYYYMMDD-HHmm-短标题/");
    expect(prompt).toContain("task-plan.md");
    expect(prompt).toContain("不要修改 .agenthub/ 目录");
    expect(prompt).toContain("不要直接开始实现，先只生成 task-plan.md");
    expect(prompt).toContain("用户需求：\n实现多任务目录管理");
  });

  it("trims surrounding whitespace from the user task", () => {
    expect(buildTaskPlanGenerationPrompt("  修复 hook 回调  ")).toContain("用户需求：\n修复 hook 回调");
  });
});

describe("buildQuotedForwardMessage", () => {
  it("combines an instruction with the quoted message", () => {
    expect(
      buildQuotedForwardMessage(
        { sender: "Claude", message: "Use a log drawer instead of a permanent panel." },
        "Implement this.",
      ),
    ).toBe("Implement this.\n\n引用 Claude 的消息：\nUse a log drawer instead of a permanent panel.");
  });

  it("forwards the quoted message directly when no instruction is provided", () => {
    expect(buildQuotedForwardMessage({ sender: "Codex", message: "Done." }, "")).toBe("Done.");
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
