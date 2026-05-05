import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationArtifactStore } from "./conversation-artifact-store";
import { ConversationOrchestrator, type ConversationSessionGateway } from "./conversation-orchestrator";
import { ConversationStore } from "./conversation-store";
import { type AgentHubEvent, EventStore } from "./event-store";

class FakeSessionGateway implements ConversationSessionGateway {
  sessions: ReturnType<ConversationSessionGateway["listSessions"]> = [];
  writes: Array<{ sessionId: string; data: string }> = [];

  listSessions(): ReturnType<ConversationSessionGateway["listSessions"]> {
    return this.sessions;
  }

  write(sessionId: string, data: string): void {
    this.writes.push({ sessionId, data });
  }
}

class FailingPairArtifactStore extends ConversationArtifactStore {
  override initializePairConversation(
    workspacePath: Parameters<ConversationArtifactStore["initializePairConversation"]>[0],
    input: Parameters<ConversationArtifactStore["initializePairConversation"]>[1],
  ): ReturnType<ConversationArtifactStore["initializePairConversation"]> {
    void workspacePath;
    void input;
    return Promise.reject(new Error("artifact init failed"));
  }
}

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("ConversationOrchestrator", () => {
  it("starts a manager conversation and sends the initial prompt to the online Claude supervisor", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];

    const conversation = await newOrchestrator(gateway).startManager({
      workspacePath,
      topic: "Implement the dashboard filters",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex", "gemini"],
      maxSteps: 4,
    });

    expect(conversation).toMatchObject({
      mode: "manager",
      status: "running",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex", "gemini"],
      topic: "Implement the dashboard filters",
      currentStep: 1,
      maxSteps: 4,
    });
    expect(gateway.writes).toHaveLength(1);
    expect(gateway.writes[0]).toMatchObject({ sessionId: "claude-session" });
    expect(gateway.writes[0].data).toContain("AgentHub manager conversation");
    expect(gateway.writes[0].data).toContain("Topic: Implement the dashboard filters");
    expect(gateway.writes[0].data).toContain("<agenthub>");
  });

  it("delivers a Claude send command to Codex and appends an agent_forward event", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const eventStore = new EventStore();
    const orchestrator = newOrchestrator(gateway, eventStore);
    const conversation = await orchestrator.startManager({
      workspacePath,
      topic: "Implement task A",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex"],
      maxSteps: 4,
    });
    gateway.writes = [];

    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-output-1",
        conversationId: conversation.id,
        profileId: "claude",
        message:
          'I will delegate this.\n<agenthub>\n{"action":"send","target":"codex","task_id":"T-001","message":"Implement task A."}\n</agenthub>',
      }),
    );

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.writes[0].sessionId).toBe("codex-session");
    expect(gateway.writes[0].data).toContain(`Conversation: ${conversation.id}`);
    expect(gateway.writes[0].data).toContain("Task: T-001");
    expect(gateway.writes[0].data).toContain("Implement task A.");
    expect(gateway.writes[0].data.endsWith("\r\n")).toBe(true);
    const forwardEvents = (await eventStore.list(workspacePath)).filter((event) => event.type === "agent_forward");
    expect(forwardEvents).toMatchObject([
      {
        type: "agent_forward",
        conversationId: conversation.id,
        taskId: "T-001",
        parentEventId: "claude-output-1",
        profileId: "claude",
        targetProfileId: "codex",
        targetProfileIds: ["codex"],
        deliveryStatus: "sent",
        sessionId: "codex-session",
      },
    ]);
  });

  it("sends a matching Codex task observation back to the Claude supervisor", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const eventStore = new EventStore();
    const orchestrator = newOrchestrator(gateway, eventStore);
    const conversation = await orchestrator.startManager({
      workspacePath,
      topic: "Implement task A",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex"],
      maxSteps: 5,
    });
    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-output-1",
        conversationId: conversation.id,
        profileId: "claude",
        message:
          '<agenthub>{"action":"send","target":"codex","task_id":"T-001","message":"Implement task A."}</agenthub>',
      }),
    );
    gateway.writes = [];

    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "codex-output-1",
        conversationId: conversation.id,
        taskId: "T-001",
        profileId: "codex",
        message: "Implemented task A and added tests.",
      }),
    );

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.writes[0].sessionId).toBe("claude-session");
    expect(gateway.writes[0].data).toContain("Observation from codex");
    expect(gateway.writes[0].data).toContain("Task: T-001");
    expect(gateway.writes[0].data).toContain("Implemented task A and added tests.");
  });

  it("stops delivery and pauses the conversation after maxSteps is reached", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const conversationStore = new ConversationStore();
    const eventStore = new EventStore();
    const orchestrator = new ConversationOrchestrator(conversationStore, eventStore, gateway);
    const conversation = await orchestrator.startManager({
      workspacePath,
      topic: "Implement one bounded task",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex"],
      maxSteps: 1,
    });
    gateway.writes = [];

    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-output-1",
        conversationId: conversation.id,
        profileId: "claude",
        message:
          '<agenthub>{"action":"send","target":"codex","task_id":"T-001","message":"This should not be delivered."}</agenthub>',
      }),
    );

    expect(gateway.writes).toEqual([]);
    await expect(conversationStore.list(workspacePath)).resolves.toMatchObject([
      {
        id: conversation.id,
        status: "paused",
        currentStep: 1,
      },
    ]);
    await expect(eventStore.list(workspacePath)).resolves.toMatchObject([
      {
        type: "orchestration_step",
        conversationId: conversation.id,
        status: "paused",
      },
    ]);
  });

  it("records manager start in the event timeline after the first step is persisted", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [{ sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" }];
    const eventStore = new EventStore();
    const conversationStore = new ConversationStore();
    const orchestrator = new ConversationOrchestrator(conversationStore, eventStore, gateway);

    const conversation = await orchestrator.startManager({
      workspacePath,
      topic: "Manage feature work",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex", "gemini"],
      maxSteps: 4,
    });

    await expect(conversationStore.list(workspacePath)).resolves.toMatchObject([
      { id: conversation.id, currentStep: 1, status: "running" },
    ]);
    await expect(eventStore.list(workspacePath)).resolves.toMatchObject([
      {
        type: "orchestration_step",
        conversationId: conversation.id,
        status: "running",
        message: "Manager conversation started: Manage feature work",
      },
    ]);
  });

  it("uses a bounded default maxSteps when omitted", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [{ sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" }];

    const conversation = await newOrchestrator(gateway).startManager({
      workspacePath,
      topic: "Bounded manager",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex"],
    });

    expect(conversation.maxSteps).toBe(12);
  });

  it("rejects supervisor send commands for non-participant targets", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "powershell-session", profileId: "powershell", workspacePath, status: "online" },
    ];
    const eventStore = new EventStore();
    const conversationStore = new ConversationStore();
    const orchestrator = new ConversationOrchestrator(conversationStore, eventStore, gateway);
    const conversation = await orchestrator.startManager({
      workspacePath,
      topic: "Keep targets bounded",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex"],
      maxSteps: 4,
    });
    gateway.writes = [];

    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-output-1",
        conversationId: conversation.id,
        profileId: "claude",
        message:
          '<agenthub>{"action":"send","target":"powershell","task_id":"T-001","message":"dir"}</agenthub>',
      }),
    );

    expect(gateway.writes).toEqual([]);
    const failedForwardEvents = (await eventStore.list(workspacePath)).filter(
      (event) => event.type === "agent_forward" && event.deliveryStatus === "failed",
    );
    expect(failedForwardEvents).toMatchObject([
      {
        type: "agent_forward",
        conversationId: conversation.id,
        taskId: "T-001",
        targetProfileId: "powershell",
        deliveryStatus: "failed",
      },
    ]);
  });

  it("marks observations as observed and ignores duplicate task outputs", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const eventStore = new EventStore();
    const orchestrator = newOrchestrator(gateway, eventStore);
    const conversation = await orchestrator.startManager({
      workspacePath,
      topic: "Implement once",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex"],
      maxSteps: 6,
    });
    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-output-1",
        conversationId: conversation.id,
        profileId: "claude",
        message: '<agenthub>{"action":"send","target":"codex","task_id":"T-001","message":"Implement once."}</agenthub>',
      }),
    );
    gateway.writes = [];

    const output = agentOutput({
      id: "codex-output-1",
      conversationId: conversation.id,
      taskId: "T-001",
      profileId: "codex",
      message: "Done once.",
    });
    await orchestrator.handleAgentOutput(workspacePath, output);
    await orchestrator.handleAgentOutput(workspacePath, { ...output, id: "codex-output-duplicate" });

    expect(gateway.writes).toHaveLength(1);
    expect((await eventStore.list(workspacePath)).filter((event) => event.deliveryStatus === "observed")).toHaveLength(1);
  });

  it("handles done and ask_user supervisor commands", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [{ sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" }];
    const conversationStore = new ConversationStore();
    const eventStore = new EventStore();
    const orchestrator = new ConversationOrchestrator(conversationStore, eventStore, gateway);
    const doneConversation = await orchestrator.startManager({
      workspacePath,
      topic: "Finish",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex"],
      maxSteps: 4,
    });
    const askConversation = await orchestrator.startManager({
      workspacePath,
      topic: "Ask",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex"],
      maxSteps: 4,
    });

    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-done",
        conversationId: doneConversation.id,
        profileId: "claude",
        message: '<agenthub>{"action":"done","message":"Finished."}</agenthub>',
      }),
    );
    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-ask",
        conversationId: askConversation.id,
        profileId: "claude",
        message: '<agenthub>{"action":"ask_user","message":"Choose an option."}</agenthub>',
      }),
    );

    await expect(conversationStore.list(workspacePath)).resolves.toMatchObject([
      { id: askConversation.id, status: "paused" },
      { id: doneConversation.id, status: "completed" },
    ]);
    const terminalStepEvents = (await eventStore.list(workspacePath)).filter(
      (event) => event.status === "completed" || event.status === "paused",
    );
    expect(terminalStepEvents).toMatchObject([
      { type: "orchestration_step", conversationId: doneConversation.id, status: "completed" },
      { type: "orchestration_step", conversationId: askConversation.id, status: "paused" },
    ]);
  });

  it("uses Gemini CRLF submission for a Gemini supervisor", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [{ sessionId: "gemini-session", profileId: "gemini", workspacePath, status: "online" }];

    await newOrchestrator(gateway).startManager({
      workspacePath,
      topic: "Gemini manages",
      supervisorProfileId: "gemini",
      participantProfileIds: ["codex"],
      maxSteps: 4,
    });

    expect(gateway.writes[0].data.endsWith("\r\n")).toBe(true);
  });

  it("does not let delayed supervisor commands mutate completed conversations", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [{ sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" }];
    const conversationStore = new ConversationStore();
    const orchestrator = new ConversationOrchestrator(conversationStore, new EventStore(), gateway);
    const conversation = await orchestrator.startManager({
      workspacePath,
      topic: "Complete once",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex"],
      maxSteps: 4,
    });

    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-done",
        conversationId: conversation.id,
        profileId: "claude",
        message: '<agenthub>{"action":"done","message":"Finished."}</agenthub>',
      }),
    );
    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-late-ask",
        conversationId: conversation.id,
        profileId: "claude",
        message: '<agenthub>{"action":"ask_user","message":"Late question."}</agenthub>',
      }),
    );

    await expect(conversationStore.list(workspacePath)).resolves.toMatchObject([
      { id: conversation.id, status: "completed" },
    ]);
  });

  it("records supervisor delivery failures when starting without an online supervisor", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const eventStore = new EventStore();
    const conversationStore = new ConversationStore();
    const conversation = await new ConversationOrchestrator(conversationStore, eventStore, new FakeSessionGateway()).startManager({
      workspacePath,
      topic: "No supervisor",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex"],
      maxSteps: 4,
    });

    await expect(conversationStore.list(workspacePath)).resolves.toMatchObject([
      { id: conversation.id, status: "failed" },
    ]);
    await expect(eventStore.list(workspacePath)).resolves.toMatchObject([
      { type: "orchestration_step", conversationId: conversation.id, status: "failed" },
    ]);
  });

  it("records parse errors from supervisor command blocks", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [{ sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" }];
    const eventStore = new EventStore();
    const orchestrator = newOrchestrator(gateway, eventStore);
    const conversation = await orchestrator.startManager({
      workspacePath,
      topic: "Parse errors",
      supervisorProfileId: "claude",
      participantProfileIds: ["codex"],
      maxSteps: 4,
    });

    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-bad-command",
        conversationId: conversation.id,
        profileId: "claude",
        message: '<agenthub>{"action":"send","target":"codex"</agenthub>',
      }),
    );

    const parseErrorEvents = (await eventStore.list(workspacePath)).filter((event) => event.status === "parse_error");
    expect(parseErrorEvents).toMatchObject([
      { type: "orchestration_step", conversationId: conversation.id, status: "parse_error" },
    ]);
  });

  it("runs a bounded roundtable in fixed order and asks Claude for the final summary", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
      { sessionId: "gemini-session", profileId: "gemini", workspacePath, status: "online" },
    ];
    const conversationStore = new ConversationStore();
    const eventStore = new EventStore();
    const orchestrator = new ConversationOrchestrator(conversationStore, eventStore, gateway);

    const conversation = await orchestrator.startRoundtable({
      workspacePath,
      topic: "讨论插件架构",
      participantProfileIds: ["claude", "codex", "gemini"],
      maxRounds: 1,
    });

    expect(conversation).toMatchObject({
      mode: "roundtable",
      status: "running",
      participantProfileIds: ["claude", "codex", "gemini"],
      currentStep: 1,
      maxSteps: 4,
    });
    expect(gateway.writes).toMatchObject([{ sessionId: "claude-session" }]);
    expect(gateway.writes[0].data).toContain("讨论插件架构");

    gateway.writes = [];
    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-round-1",
        conversationId: conversation.id,
        profileId: "claude",
        message: "Claude 方案。",
      }),
    );
    expect(gateway.writes).toMatchObject([{ sessionId: "codex-session" }]);
    expect(gateway.writes[0].data).toContain("Claude 方案。");

    gateway.writes = [];
    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "codex-round-1",
        conversationId: conversation.id,
        profileId: "codex",
        message: "Codex 实现建议。",
      }),
    );
    expect(gateway.writes).toMatchObject([{ sessionId: "gemini-session" }]);
    expect(gateway.writes[0].data).toContain("Codex 实现建议。");

    gateway.writes = [];
    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "gemini-round-1",
        conversationId: conversation.id,
        profileId: "gemini",
        message: "Gemini review。",
      }),
    );
    expect(gateway.writes).toMatchObject([{ sessionId: "claude-session" }]);
    expect(gateway.writes[0].data).toContain("最终总结");

    gateway.writes = [];
    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-summary",
        conversationId: conversation.id,
        profileId: "claude",
        message: "最终结论。",
      }),
    );

    expect(gateway.writes).toEqual([]);
    await expect(conversationStore.list(workspacePath)).resolves.toMatchObject([
      { id: conversation.id, status: "completed", currentStep: 4 },
    ]);
    expect((await eventStore.list(workspacePath)).filter((event) => event.type === "agent_forward")).toHaveLength(3);
  });

  it("stops roundtable automatic delivery at maxRounds", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const conversationStore = new ConversationStore();
    const orchestrator = new ConversationOrchestrator(conversationStore, new EventStore(), gateway);
    const conversation = await orchestrator.startRoundtable({
      workspacePath,
      topic: "只跑一轮",
      participantProfileIds: ["claude", "codex"],
      maxRounds: 1,
    });
    gateway.writes = [];

    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-round-1",
        conversationId: conversation.id,
        profileId: "claude",
        message: "Claude first.",
      }),
    );
    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "codex-round-1",
        conversationId: conversation.id,
        profileId: "codex",
        message: "Codex second.",
      }),
    );
    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-summary",
        conversationId: conversation.id,
        profileId: "claude",
        message: "Summary.",
      }),
    );

    expect(gateway.writes.map((write) => write.sessionId)).toEqual(["codex-session", "claude-session"]);
    await expect(conversationStore.list(workspacePath)).resolves.toMatchObject([
      { id: conversation.id, status: "completed", currentStep: 3, maxSteps: 3 },
    ]);
  });

  it("uses two default roundtable rounds and canonical known-agent order", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
      { sessionId: "gemini-session", profileId: "gemini", workspacePath, status: "online" },
    ];

    const conversation = await newOrchestrator(gateway).startRoundtable({
      workspacePath,
      topic: "默认讨论",
      participantProfileIds: ["gemini", "codex", "claude"],
    });

    expect(conversation.participantProfileIds).toEqual(["claude", "codex", "gemini"]);
    expect(conversation.maxSteps).toBe(7);
    expect(gateway.writes).toMatchObject([{ sessionId: "claude-session" }]);
  });

  it("starts pair negotiation with Claude first and alternates a continue command to Codex", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const conversationStore = new ConversationStore();
    const eventStore = new EventStore();
    const orchestrator = new ConversationOrchestrator(conversationStore, eventStore, gateway);

    const conversation = await orchestrator.startPairNegotiation({
      workspacePath,
      topic: "Decide the hook retry design",
      participantProfileIds: ["claude", "codex"],
      maxRounds: 3,
    });

    expect(conversation).toMatchObject({
      mode: "pair_negotiation",
      status: "running",
      participantProfileIds: ["claude", "codex"],
      currentStep: 1,
      maxSteps: 6,
    });
    expect(gateway.writes).toMatchObject([{ sessionId: "claude-session" }]);
    expect(gateway.writes[0].data).toContain("Decide the hook retry design");
    expect(gateway.writes[0].data).toContain('<agenthub>{"action":"continue"');
    expect(gateway.writes[0].data).not.toContain("Conversation:");
    expect(gateway.writes[0].data).not.toContain("Participants:");

    gateway.writes = [];
    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-pair-1",
        conversationId: conversation.id,
        profileId: "claude",
        message:
          '<agenthub>{"action":"continue","proposal_version":1,"summary":"Use bounded retry.","message":"Please review bounded retry with idempotency."}</agenthub>',
      }),
    );

    expect(gateway.writes).toMatchObject([{ sessionId: "codex-session" }]);
    const legacyArtifactPath = `.agenthub/conversations/${conversation.id}/turns/0001-claude.md`;
    expect(gateway.writes[0].data).toContain("claude");
    expect(gateway.writes[0].data).toContain("Use bounded retry.");
    expect(gateway.writes[0].data).toContain(legacyArtifactPath);
    expect(gateway.writes[0].data).not.toContain("Please review bounded retry with idempotency.");
    await expect(readFile(path.join(workspacePath, legacyArtifactPath), "utf8")).resolves.toContain(
      "Please review bounded retry with idempotency.",
    );
    await expect(conversationStore.list(workspacePath)).resolves.toMatchObject([
      { id: conversation.id, status: "running", currentStep: 2 },
    ]);
    const forwardEvents = (await eventStore.list(workspacePath)).filter((event) => event.type === "agent_forward");
    expect(forwardEvents).toMatchObject([
      {
        conversationId: conversation.id,
        parentEventId: "claude-pair-1",
        profileId: "claude",
        targetProfileId: "codex",
        deliveryStatus: "sent",
      },
    ]);
  });

  it("starts file-backed pair negotiation with brief, memory, and first output path", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const conversationStore = new ConversationStore();
    const eventStore = new EventStore();
    const orchestrator = new ConversationOrchestrator(conversationStore, eventStore, gateway);

    const conversation = await orchestrator.startPairNegotiation({
      workspacePath,
      topic: "Decide the file memory design",
      participantProfileIds: ["claude", "codex"],
      maxRounds: 3,
    });

    expect(gateway.writes).toMatchObject([{ sessionId: "claude-session" }]);
    expect(gateway.writes[0].data).toContain(`.agenthub/conversations/${conversation.id}/brief.md`);
    expect(gateway.writes[0].data).toContain(`.agenthub/conversations/${conversation.id}/memory.md`);
    expect(gateway.writes[0].data).toContain(`.agenthub/conversations/${conversation.id}/turns/0001-claude.md`);
    await expect(
      readFile(path.join(workspacePath, ".agenthub", "conversations", conversation.id, "brief.md"), "utf8"),
    ).resolves.toContain("Decide the file memory design");
  });

  it("marks pair negotiation failed when artifact initialization fails", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const conversationStore = new ConversationStore();
    const eventStore = new EventStore();
    const orchestrator = new ConversationOrchestrator(
      conversationStore,
      eventStore,
      gateway,
      new FailingPairArtifactStore(),
    );

    const conversation = await orchestrator.startPairNegotiation({
      workspacePath,
      topic: "Handle artifact startup failure",
      participantProfileIds: ["claude", "codex"],
      maxRounds: 3,
    });

    expect(conversation).toMatchObject({ status: "failed" });
    expect(gateway.writes).toEqual([]);
    await expect(conversationStore.list(workspacePath)).resolves.toMatchObject([
      { id: conversation.id, status: "failed" },
    ]);
    await expect(eventStore.list(workspacePath)).resolves.toMatchObject([
      {
        type: "orchestration_step",
        conversationId: conversation.id,
        status: "failed",
        error: expect.stringContaining("artifact init failed"),
      },
    ]);
  });

  it("continues pair negotiation with artifact paths and avoids forwarding full artifact text", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const eventStore = new EventStore();
    const orchestrator = newOrchestrator(gateway, eventStore);
    const conversation = await orchestrator.startPairNegotiation({
      workspacePath,
      topic: "Review file memory",
      participantProfileIds: ["claude", "codex"],
      maxRounds: 3,
    });
    const artifactPath = `.agenthub/conversations/${conversation.id}/turns/0001-claude.md`;
    await writeFile(path.join(workspacePath, artifactPath), "Full proposal body stored in a file.", "utf8");
    gateway.writes = [];

    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-file-turn",
        conversationId: conversation.id,
        profileId: "claude",
        message: `<agenthub>{"action":"continue","proposal_version":1,"artifact_path":"${artifactPath}","summary":"Stored proposal"}</agenthub>`,
      }),
    );

    const nextArtifactPath = `.agenthub/conversations/${conversation.id}/turns/0002-codex.md`;
    expect(gateway.writes).toMatchObject([{ sessionId: "codex-session" }]);
    expect(gateway.writes[0].data).toContain(artifactPath);
    expect(gateway.writes[0].data).toContain(nextArtifactPath);
    expect(gateway.writes[0].data).not.toContain("Full proposal body stored in a file.");
    const forwardEvents = (await eventStore.list(workspacePath)).filter((event) => event.type === "agent_forward");
    expect(forwardEvents.at(-1)).toMatchObject({
      message: "Stored proposal",
      metadata: {
        artifactPath,
        nextArtifactPath,
      },
    });
  });

  it("pauses pair negotiation when the reported artifact file is missing", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const conversationStore = new ConversationStore();
    const eventStore = new EventStore();
    const orchestrator = new ConversationOrchestrator(conversationStore, eventStore, gateway);
    const conversation = await orchestrator.startPairNegotiation({
      workspacePath,
      topic: "Missing file case",
      participantProfileIds: ["claude", "codex"],
      maxRounds: 3,
    });
    const artifactPath = `.agenthub/conversations/${conversation.id}/turns/0001-claude.md`;
    gateway.writes = [];

    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-missing-file",
        conversationId: conversation.id,
        profileId: "claude",
        message: `<agenthub>{"action":"continue","proposal_version":1,"artifact_path":"${artifactPath}","summary":"Missing file"}</agenthub>`,
      }),
    );

    expect(gateway.writes).toEqual([]);
    await expect(conversationStore.list(workspacePath)).resolves.toMatchObject([
      { id: conversation.id, status: "paused" },
    ]);
    expect((await eventStore.list(workspacePath)).at(-1)).toMatchObject({
      type: "orchestration_step",
      status: "waiting_artifact",
      parentEventId: "claude-missing-file",
      metadata: { artifactPath },
    });
  });

  it("sends artifact-backed pair acceptance prompts with previous and next output paths", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const eventStore = new EventStore();
    const orchestrator = newOrchestrator(gateway, eventStore);
    const conversation = await orchestrator.startPairNegotiation({
      workspacePath,
      topic: "Confirm file-backed design",
      participantProfileIds: ["claude", "codex"],
      maxRounds: 3,
    });
    const artifactPath = `.agenthub/conversations/${conversation.id}/turns/0001-claude.md`;
    await writeFile(path.join(workspacePath, artifactPath), "Accepted proposal body stored in a file.", "utf8");
    gateway.writes = [];

    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-file-accept",
        conversationId: conversation.id,
        profileId: "claude",
        message: `<agenthub>{"action":"accept","proposal_version":2,"artifact_path":"${artifactPath}","summary":"Stored accepted proposal"}</agenthub>`,
      }),
    );

    const nextArtifactPath = `.agenthub/conversations/${conversation.id}/turns/0002-codex.md`;
    expect(gateway.writes).toMatchObject([{ sessionId: "codex-session" }]);
    expect(gateway.writes[0].data).toContain(artifactPath);
    expect(gateway.writes[0].data).toContain(nextArtifactPath);
    expect(gateway.writes[0].data).not.toContain("Accepted proposal body stored in a file.");
    const forwardEvents = (await eventStore.list(workspacePath)).filter((event) => event.type === "agent_forward");
    expect(forwardEvents.at(-1)).toMatchObject({
      message: "Stored accepted proposal",
      metadata: {
        artifactPath,
        nextArtifactPath,
      },
    });
  });

  it("does not complete pair negotiation when the second accept references a missing artifact", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const conversationStore = new ConversationStore();
    const eventStore = new EventStore();
    const orchestrator = new ConversationOrchestrator(conversationStore, eventStore, gateway);
    const conversation = await orchestrator.startPairNegotiation({
      workspacePath,
      topic: "Require accept artifacts before completion",
      participantProfileIds: ["claude", "codex"],
      maxRounds: 3,
    });
    const claudeArtifactPath = `.agenthub/conversations/${conversation.id}/turns/0001-claude.md`;
    await writeFile(path.join(workspacePath, claudeArtifactPath), "Claude accepted artifact.", "utf8");

    gateway.writes = [];
    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-valid-accept",
        conversationId: conversation.id,
        profileId: "claude",
        message: `<agenthub>{"action":"accept","proposal_version":2,"artifact_path":"${claudeArtifactPath}","summary":"Claude accepts"}</agenthub>`,
      }),
    );

    const missingCodexArtifactPath = `.agenthub/conversations/${conversation.id}/turns/0002-codex.md`;
    gateway.writes = [];
    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "codex-missing-accept",
        conversationId: conversation.id,
        profileId: "codex",
        message: `<agenthub>{"action":"accept","proposal_version":2,"artifact_path":"${missingCodexArtifactPath}","summary":"Codex accepts with missing artifact"}</agenthub>`,
      }),
    );

    expect(gateway.writes).toEqual([]);
    await expect(conversationStore.list(workspacePath)).resolves.toMatchObject([
      { id: conversation.id, status: "paused" },
    ]);
    const events = await eventStore.list(workspacePath);
    expect(events.at(-1)).toMatchObject({
      type: "orchestration_step",
      status: "waiting_artifact",
      parentEventId: "codex-missing-accept",
      metadata: { artifactPath: missingCodexArtifactPath },
    });
    expect(events.filter((event) => event.status === "completed")).toEqual([]);
    expect(
      events.filter(
        (event) =>
          event.status === "accepted" &&
          event.metadata?.pairNegotiation &&
          event.profileId === "codex",
      ),
    ).toEqual([]);
  });

  it("forwards the previous agent visible answer with the pair negotiation command message", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const orchestrator = newOrchestrator(gateway);
    const conversation = await orchestrator.startPairNegotiation({
      workspacePath,
      topic: "Review a full proposal",
      participantProfileIds: ["claude", "codex"],
      maxRounds: 3,
    });
    gateway.writes = [];

    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-full-proposal",
        conversationId: conversation.id,
        profileId: "claude",
        message: [
          "Full proposal body that Codex must review.",
          "",
          '<agenthub>{"action":"continue","proposal_version":1,"summary":"Short summary","message":"Please review the full proposal above."}</agenthub>',
        ].join("\n"),
      }),
    );

    expect(gateway.writes).toMatchObject([{ sessionId: "codex-session" }]);
    const legacyArtifactPath = `.agenthub/conversations/${conversation.id}/turns/0001-claude.md`;
    expect(gateway.writes[0].data).toContain(legacyArtifactPath);
    expect(gateway.writes[0].data).not.toContain("Full proposal body that Codex must review.");
    expect(gateway.writes[0].data).not.toContain("Please review the full proposal above.");
    const legacyArtifact = await readFile(path.join(workspacePath, legacyArtifactPath), "utf8");
    expect(legacyArtifact).toContain("Full proposal body that Codex must review.");
    expect(legacyArtifact).toContain("Please review the full proposal above.");
    expect(gateway.writes[0].data).not.toContain('"summary":"Short summary","message":"Please review the full proposal above."');
  });

  it("completes pair negotiation when both agents accept the same proposal version", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const conversationStore = new ConversationStore();
    const eventStore = new EventStore();
    const orchestrator = new ConversationOrchestrator(conversationStore, eventStore, gateway);
    const conversation = await orchestrator.startPairNegotiation({
      workspacePath,
      topic: "Agree on the UI cleanup plan",
      participantProfileIds: ["claude", "codex"],
      maxRounds: 3,
    });

    gateway.writes = [];
    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-accept",
        conversationId: conversation.id,
        profileId: "claude",
        message: '<agenthub>{"action":"accept","proposal_version":2,"summary":"Use the compact chat layout."}</agenthub>',
      }),
    );

    expect(gateway.writes).toMatchObject([{ sessionId: "codex-session" }]);
    expect(gateway.writes[0].data).toContain('"proposal_version":2');
    expect(gateway.writes[0].data).toContain("Use the compact chat layout.");

    gateway.writes = [];
    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "codex-accept",
        conversationId: conversation.id,
        profileId: "codex",
        message: '<agenthub>{"action":"accept","proposal_version":2,"summary":"Codex also accepts compact chat layout."}</agenthub>',
      }),
    );

    expect(gateway.writes).toEqual([]);
    await expect(conversationStore.list(workspacePath)).resolves.toMatchObject([
      { id: conversation.id, status: "completed", currentStep: 2 },
    ]);
    const completedEvents = (await eventStore.list(workspacePath)).filter((event) => event.status === "completed");
    expect(completedEvents).toMatchObject([
      expect.objectContaining({
        type: "orchestration_step",
        conversationId: conversation.id,
        message: "Pair negotiation completed on proposal version 2",
      }),
    ]);
  });

  it("pauses pair negotiation instead of continuing past the max round limit", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const conversationStore = new ConversationStore();
    const eventStore = new EventStore();
    const orchestrator = new ConversationOrchestrator(conversationStore, eventStore, gateway);
    const conversation = await orchestrator.startPairNegotiation({
      workspacePath,
      topic: "Only one exchange",
      participantProfileIds: ["claude", "codex"],
      maxRounds: 1,
    });
    gateway.writes = [];

    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "claude-continue",
        conversationId: conversation.id,
        profileId: "claude",
        message:
          '<agenthub>{"action":"continue","proposal_version":1,"summary":"First view.","message":"Codex should review once."}</agenthub>',
      }),
    );
    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "codex-continue",
        conversationId: conversation.id,
        profileId: "codex",
        message:
          '<agenthub>{"action":"continue","proposal_version":2,"summary":"Needs another revision.","message":"Claude should revise again."}</agenthub>',
      }),
    );

    expect(gateway.writes.map((write) => write.sessionId)).toEqual(["codex-session"]);
    await expect(conversationStore.list(workspacePath)).resolves.toMatchObject([
      { id: conversation.id, status: "paused", currentStep: 2, maxSteps: 2 },
    ]);
    const pausedEvents = (await eventStore.list(workspacePath)).filter((event) => event.status === "paused");
    expect(pausedEvents).toMatchObject([
      expect.objectContaining({
        type: "orchestration_step",
        conversationId: conversation.id,
        message: "Pair negotiation paused because max rounds were reached",
      }),
    ]);
  });

  it("ignores out-of-turn pair negotiation output", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];
    const orchestrator = newOrchestrator(gateway);
    const conversation = await orchestrator.startPairNegotiation({
      workspacePath,
      topic: "Order matters",
      participantProfileIds: ["claude", "codex"],
      maxRounds: 2,
    });
    gateway.writes = [];

    await orchestrator.handleAgentOutput(
      workspacePath,
      agentOutput({
        id: "codex-too-early",
        conversationId: conversation.id,
        profileId: "codex",
        message:
          '<agenthub>{"action":"continue","proposal_version":1,"summary":"Out of turn.","message":"This should not send."}</agenthub>',
      }),
    );

    expect(gateway.writes).toEqual([]);
  });

  it("loads pair negotiation prompts from the built-in global prompt files", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
    const promptPath = path.join(workspacePath, ".agenthub", "prompts", "pair-initial.md");
    await mkdir(path.dirname(promptPath), { recursive: true });
    await writeFile(
      promptPath,
      [
        "CUSTOM PAIR TEMPLATE: {{topic}}",
        "Brief={{brief_path}} Memory={{memory_path}} Output={{output_path}}",
        '<agenthub>{"action":"continue","proposal_version":1,"artifact_path":"{{output_path}}","summary":"custom"}</agenthub>',
      ].join("\n"),
      "utf8",
    );
    const gateway = new FakeSessionGateway();
    gateway.sessions = [
      { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
      { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
    ];

    await newOrchestrator(gateway).startPairNegotiation({
      workspacePath,
      topic: "Use editable files",
      participantProfileIds: ["claude", "codex"],
    });

    expect(gateway.writes).toMatchObject([{ sessionId: "claude-session" }]);
    expect(gateway.writes[0].data).not.toContain("CUSTOM PAIR TEMPLATE");
    expect(gateway.writes[0].data).toContain("Use editable files");
    expect(gateway.writes[0].data).toContain(".agenthub/conversations/");
  });
});

function newOrchestrator(
  gateway: ConversationSessionGateway,
  eventStore = new EventStore(),
): ConversationOrchestrator {
  return new ConversationOrchestrator(new ConversationStore(), eventStore, gateway);
}

function agentOutput(input: {
  id: string;
  conversationId: string;
  profileId: string;
  message: string;
  taskId?: string;
}): AgentHubEvent {
  return {
    id: input.id,
    type: "agent_output",
    timestamp: "2026-05-02T00:00:00.000Z",
    conversationId: input.conversationId,
    profileId: input.profileId,
    taskId: input.taskId,
    message: input.message,
  };
}
