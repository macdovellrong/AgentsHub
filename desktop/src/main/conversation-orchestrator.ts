import { parseAgentHubCommands } from "./agent-command-parser";
import type { AgentHubCommand } from "./agent-command-parser";
import { ConversationArtifactStore } from "./conversation-artifact-store";
import type { AgentConversation, ConversationStore } from "./conversation-store";
import type { AgentHubEvent, EventStore } from "./event-store";
import { loadAndRenderPairPromptTemplate } from "./pair-prompt-templates";
import { toSubmittedTerminalInput } from "./terminal-input";

const DEFAULT_MAX_STEPS = 12;
const DEFAULT_MAX_ROUNDS = 2;
const DEFAULT_PAIR_NEGOTIATION_MAX_ROUNDS = 3;
const ROUNDTABLE_PROFILE_ORDER = ["claude", "codex", "gemini"];
const WAITING_ARTIFACT = Symbol("waiting_artifact");

export type ConversationSession = {
  sessionId: string;
  profileId: string;
  workspacePath: string;
  status: "online" | "exited";
};

export type ConversationSessionGateway = {
  listSessions(): ConversationSession[];
  write(sessionId: string, data: string): void;
};

export type StartManagerConversationInput = {
  workspacePath: string;
  topic: string;
  supervisorProfileId?: string;
  participantProfileIds: string[];
  maxSteps?: number | null;
};

export type StartRoundtableConversationInput = {
  workspacePath: string;
  topic: string;
  participantProfileIds: string[];
  maxRounds?: number | null;
};

export type StartPairNegotiationConversationInput = {
  workspacePath: string;
  topic: string;
  participantProfileIds: string[];
  maxRounds?: number | null;
};

export class ConversationOrchestrator {
  constructor(
    private readonly conversationStore: ConversationStore,
    private readonly eventStore: EventStore,
    private readonly sessions: ConversationSessionGateway,
    private readonly artifacts = new ConversationArtifactStore(),
  ) {}

  async startManager(input: StartManagerConversationInput): Promise<AgentConversation> {
    const supervisorProfileId = input.supervisorProfileId ?? "claude";
    const conversation = await this.conversationStore.create(input.workspacePath, {
      mode: "manager",
      supervisorProfileId,
      participantProfileIds: input.participantProfileIds,
      topic: input.topic,
      maxSteps: input.maxSteps ?? DEFAULT_MAX_STEPS,
    });

    const supervisorSession = this.findOnlineSession(input.workspacePath, supervisorProfileId);
    if (!supervisorSession) {
      await this.eventStore.append(input.workspacePath, {
        type: "orchestration_step",
        message: `No online supervisor session for ${supervisorProfileId}`,
        conversationId: conversation.id,
        profileId: supervisorProfileId,
        status: "failed",
        error: `No online session for profile ${supervisorProfileId}`,
      });
      return this.conversationStore.update(input.workspacePath, conversation.id, { status: "failed" });
    }

    this.sessions.write(
      supervisorSession.sessionId,
      this.toTerminalInput(this.buildInitialManagerPrompt(conversation), supervisorProfileId),
    );
    const updated = await this.recordDeliveryStep(input.workspacePath, conversation);
    await this.eventStore.append(input.workspacePath, {
      type: "orchestration_step",
      message: `Manager conversation started: ${conversation.topic}`,
      conversationId: conversation.id,
      profileId: supervisorProfileId,
      sessionId: supervisorSession.sessionId,
      targetProfileId: supervisorProfileId,
      targetProfileIds: [supervisorProfileId],
      status: updated.status,
    });
    return updated;
  }

  async startRoundtable(input: StartRoundtableConversationInput): Promise<AgentConversation> {
    if (input.participantProfileIds.length === 0) {
      throw new Error("Roundtable requires at least one participant");
    }

    const participantProfileIds = normalizeRoundtableParticipants(input.participantProfileIds);
    const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
    const maxSteps = participantProfileIds.length * maxRounds + 1;
    const conversation = await this.conversationStore.create(input.workspacePath, {
      mode: "roundtable",
      supervisorProfileId: null,
      participantProfileIds,
      topic: input.topic,
      maxSteps,
    });
    const firstProfileId = conversation.participantProfileIds[0];
    const firstSession = this.findOnlineSession(input.workspacePath, firstProfileId);
    if (!firstSession) {
      await this.eventStore.append(input.workspacePath, {
        type: "orchestration_step",
        message: `No online roundtable session for ${firstProfileId}`,
        conversationId: conversation.id,
        profileId: firstProfileId,
        status: "failed",
        error: `No online session for profile ${firstProfileId}`,
      });
      return this.conversationStore.update(input.workspacePath, conversation.id, { status: "failed" });
    }

    this.sessions.write(
      firstSession.sessionId,
      this.toTerminalInput(this.buildInitialRoundtablePrompt(conversation), firstProfileId),
    );
    const updated = await this.recordDeliveryStep(input.workspacePath, conversation);
    await this.eventStore.append(input.workspacePath, {
      type: "orchestration_step",
      message: `Roundtable started: ${conversation.topic}`,
      conversationId: conversation.id,
      profileId: firstProfileId,
      sessionId: firstSession.sessionId,
      targetProfileId: firstProfileId,
      targetProfileIds: [firstProfileId],
      status: updated.status,
    });
    return updated;
  }

  async startPairNegotiation(input: StartPairNegotiationConversationInput): Promise<AgentConversation> {
    const participantProfileIds = normalizePairNegotiationParticipants(input.participantProfileIds);
    const maxRounds = input.maxRounds ?? DEFAULT_PAIR_NEGOTIATION_MAX_ROUNDS;
    const conversation = await this.conversationStore.create(input.workspacePath, {
      mode: "pair_negotiation",
      supervisorProfileId: null,
      participantProfileIds,
      topic: input.topic,
      maxSteps: participantProfileIds.length * maxRounds,
    });
    const firstProfileId = conversation.participantProfileIds[0];
    let prompt: string;
    try {
      const artifactPaths = await this.artifacts.initializePairConversation(input.workspacePath, {
        conversationId: conversation.id,
        topic: conversation.topic,
        participantProfileIds: conversation.participantProfileIds,
        maxSteps: conversation.maxSteps,
      });
      const outputPath = this.artifacts.turnArtifactPath(conversation.id, 1, firstProfileId);
      prompt = await this.buildInitialPairNegotiationPrompt(input.workspacePath, conversation, {
        briefPath: artifactPaths.briefPath,
        memoryPath: artifactPaths.memoryPath,
        outputPath,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.eventStore.append(input.workspacePath, {
        type: "orchestration_step",
        message: `Pair negotiation failed to start: ${conversation.topic}`,
        conversationId: conversation.id,
        profileId: firstProfileId,
        status: "failed",
        error: message,
      });
      return this.conversationStore.update(input.workspacePath, conversation.id, { status: "failed" });
    }

    const firstSession = this.findOnlineSession(input.workspacePath, firstProfileId);
    if (!firstSession) {
      await this.eventStore.append(input.workspacePath, {
        type: "orchestration_step",
        message: `No online pair negotiation session for ${firstProfileId}`,
        conversationId: conversation.id,
        profileId: firstProfileId,
        status: "failed",
        error: `No online session for profile ${firstProfileId}`,
      });
      return this.conversationStore.update(input.workspacePath, conversation.id, { status: "failed" });
    }

    this.sessions.write(firstSession.sessionId, this.toTerminalInput(prompt, firstProfileId));
    const updated = await this.recordDeliveryStep(input.workspacePath, conversation);
    await this.eventStore.append(input.workspacePath, {
      type: "orchestration_step",
      message: `Pair negotiation started: ${conversation.topic}`,
      conversationId: conversation.id,
      profileId: firstProfileId,
      sessionId: firstSession.sessionId,
      targetProfileId: firstProfileId,
      targetProfileIds: [firstProfileId],
      status: updated.status,
    });
    return updated;
  }

  async handleAgentOutput(workspacePath: string, event: AgentHubEvent): Promise<void> {
    if (event.type !== "agent_output" || !event.conversationId || !event.profileId) {
      return;
    }

    const conversation = await this.findConversation(workspacePath, event.conversationId);
    if (!conversation) {
      return;
    }

    if (conversation.mode === "pair_negotiation") {
      await this.handlePairNegotiationOutput(workspacePath, conversation, event);
      return;
    }

    if (conversation.mode === "roundtable") {
      await this.handleRoundtableOutput(workspacePath, conversation, event);
      return;
    }

    if (event.profileId === conversation.supervisorProfileId) {
      await this.handleSupervisorOutput(workspacePath, conversation, event);
      return;
    }

    if (conversation.participantProfileIds.includes(event.profileId)) {
      await this.handleParticipantOutput(workspacePath, conversation, event);
    }
  }

  private async handlePairNegotiationOutput(
    workspacePath: string,
    conversation: AgentConversation,
    event: AgentHubEvent,
  ): Promise<void> {
    if (conversation.status !== "running" || !conversation.participantProfileIds.includes(event.profileId ?? "")) {
      return;
    }

    const currentSpeaker = this.pairNegotiationSpeakerForStep(conversation, conversation.currentStep);
    if (event.profileId !== currentSpeaker) {
      return;
    }

    const parsed = parseAgentHubCommands(event.message ?? "");
    if (parsed.errors.length > 0) {
      for (const error of parsed.errors) {
        await this.eventStore.append(workspacePath, {
          type: "orchestration_step",
          message: error.message,
          conversationId: conversation.id,
          parentEventId: event.id,
          profileId: event.profileId,
          status: "parse_error",
          error: error.message,
          metadata: { agenthubParseError: error },
        });
      }
      if (parsed.commands.length === 0) {
        return;
      }
    }

    const command = parsed.commands.find((candidate) => candidate.action === "continue" || candidate.action === "accept");
    if (!command) {
      await this.eventStore.append(workspacePath, {
        type: "orchestration_step",
        message: "Pair negotiation output did not contain a continue or accept command",
        conversationId: conversation.id,
        parentEventId: event.id,
        profileId: event.profileId,
        status: "parse_error",
      });
      return;
    }

    if (command.action === "continue") {
      await this.continuePairNegotiation(workspacePath, conversation, event, command);
      return;
    }

    await this.acceptPairNegotiationProposal(workspacePath, conversation, event, command);
  }

  private async continuePairNegotiation(
    workspacePath: string,
    conversation: AgentConversation,
    event: AgentHubEvent,
    command: Extract<AgentHubCommand, { action: "continue" }>,
  ): Promise<void> {
    if (this.hasReachedMaxSteps(conversation)) {
      await this.pausePairNegotiationAtLimit(workspacePath, conversation, event);
      return;
    }

    const targetProfileId = this.otherPairNegotiationParticipant(conversation, event.profileId ?? "");
    if (!targetProfileId) {
      return;
    }

    const artifactPath = await this.resolvePairNegotiationArtifact(
      workspacePath,
      conversation,
      event,
      command,
    );
    if (artifactPath === WAITING_ARTIFACT) {
      return;
    }

    const prompt = await this.buildPairNegotiationTurnPrompt(
      workspacePath,
      conversation,
      event,
      command,
      targetProfileId,
      artifactPath,
    );
    await this.deliverPairNegotiationTurn(
      workspacePath,
      conversation,
      event,
      targetProfileId,
      prompt,
      command,
      artifactPath,
    );
  }

  private async acceptPairNegotiationProposal(
    workspacePath: string,
    conversation: AgentConversation,
    event: AgentHubEvent,
    command: Extract<AgentHubCommand, { action: "accept" }>,
  ): Promise<void> {
    const artifactPath = await this.resolvePairNegotiationArtifact(
      workspacePath,
      conversation,
      event,
      command,
    );
    if (artifactPath === WAITING_ARTIFACT) {
      return;
    }

    await this.eventStore.append(workspacePath, {
      type: "orchestration_step",
      message: command.summary,
      conversationId: conversation.id,
      parentEventId: event.id,
      profileId: event.profileId,
      status: "accepted",
      metadata: {
        agenthubCommand: command,
        pairNegotiation: {
          action: "accept",
          acceptedBy: event.profileId,
          proposalVersion: command.proposal_version,
          summary: command.summary,
        },
      },
    });

    const acceptedProfiles = await this.pairNegotiationAcceptedProfiles(
      workspacePath,
      conversation.id,
      command.proposal_version,
    );
    if (conversation.participantProfileIds.every((profileId) => acceptedProfiles.has(profileId))) {
      await this.conversationStore.update(workspacePath, conversation.id, { status: "completed" });
      await this.eventStore.append(workspacePath, {
        type: "orchestration_step",
        message: `Pair negotiation completed on proposal version ${command.proposal_version}`,
        conversationId: conversation.id,
        parentEventId: event.id,
        profileId: event.profileId,
        status: "completed",
        metadata: { agenthubCommand: command },
      });
      return;
    }

    if (this.hasReachedMaxSteps(conversation)) {
      await this.pausePairNegotiationAtLimit(workspacePath, conversation, event);
      return;
    }

    const targetProfileId = this.otherPairNegotiationParticipant(conversation, event.profileId ?? "");
    if (!targetProfileId) {
      return;
    }

    const prompt = await this.buildPairNegotiationAcceptancePrompt(
      workspacePath,
      conversation,
      event,
      command,
      targetProfileId,
      artifactPath,
    );
    await this.deliverPairNegotiationTurn(
      workspacePath,
      conversation,
      event,
      targetProfileId,
      prompt,
      command,
      artifactPath,
    );
  }

  private async deliverPairNegotiationTurn(
    workspacePath: string,
    conversation: AgentConversation,
    event: AgentHubEvent,
    targetProfileId: string,
    prompt: string,
    command: Extract<AgentHubCommand, { action: "continue" | "accept" }>,
    artifactPath?: string | null,
  ): Promise<void> {
    const nextArtifactPath = this.artifacts.turnArtifactPath(
      conversation.id,
      conversation.currentStep + 1,
      targetProfileId,
    );
    const targetSession = this.findOnlineSession(workspacePath, targetProfileId);
    const forwardMessage = pairNegotiationCommandSummary(command, event);
    if (!targetSession) {
      await this.eventStore.append(workspacePath, {
        type: "agent_forward",
        message: forwardMessage,
        conversationId: conversation.id,
        parentEventId: event.id,
        profileId: event.profileId,
        targetProfileId,
        targetProfileIds: [targetProfileId],
        deliveryStatus: "failed",
        error: `No online session for profile ${targetProfileId}`,
        metadata: { agenthubCommand: command, artifactPath, nextArtifactPath },
      });
      await this.conversationStore.update(workspacePath, conversation.id, { status: "failed" });
      return;
    }

    this.sessions.write(targetSession.sessionId, this.toTerminalInput(prompt, targetProfileId));
    const updated = await this.recordPairNegotiationDeliveryStep(workspacePath, conversation);
    await this.eventStore.append(workspacePath, {
      type: "agent_forward",
      message: forwardMessage,
      conversationId: conversation.id,
      parentEventId: event.id,
      profileId: event.profileId,
      sessionId: targetSession.sessionId,
      targetProfileId,
      targetProfileIds: [targetProfileId],
      deliveryStatus: "sent",
      status: updated.status,
      metadata: { agenthubCommand: command, artifactPath, nextArtifactPath },
    });
  }

  private async validatePairNegotiationArtifact(
    workspacePath: string,
    conversation: AgentConversation,
    event: AgentHubEvent,
    artifactPath: string | undefined,
  ): Promise<string | null | typeof WAITING_ARTIFACT> {
    if (!artifactPath) {
      return null;
    }

    try {
      const validated = await this.artifacts.validateTurnArtifactPath(workspacePath, conversation.id, artifactPath);
      return validated.relativePath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.conversationStore.update(workspacePath, conversation.id, { status: "paused" });
      await this.eventStore.append(workspacePath, {
        type: "orchestration_step",
        message: `Artifact is not ready: ${artifactPath}`,
        conversationId: conversation.id,
        parentEventId: event.id,
        profileId: event.profileId,
        status: "waiting_artifact",
        error: message,
        metadata: { artifactPath },
      });
      return WAITING_ARTIFACT;
    }
  }

  private async resolvePairNegotiationArtifact(
    workspacePath: string,
    conversation: AgentConversation,
    event: AgentHubEvent,
    command: Extract<AgentHubCommand, { action: "continue" | "accept" }>,
  ): Promise<string | null | typeof WAITING_ARTIFACT> {
    if (command.artifact_path) {
      return this.validatePairNegotiationArtifact(workspacePath, conversation, event, command.artifact_path);
    }

    const expectedArtifactPath = this.artifacts.turnArtifactPath(
      conversation.id,
      conversation.currentStep,
      event.profileId ?? "agent",
    );
    try {
      const validated = await this.artifacts.validateTurnArtifactPath(
        workspacePath,
        conversation.id,
        expectedArtifactPath,
      );
      return validated.relativePath;
    } catch {
      // Older prompts did not include artifact_path. If the expected file is absent,
      // preserve the visible output by writing it into the current turn artifact.
    }

    const legacyMessage = "message" in command ? command.message ?? "" : "";
    const content = buildPairNegotiationTurnBody(event.message ?? "", legacyMessage);
    if (!content.trim()) {
      return null;
    }

    try {
      const written = await this.artifacts.writeTurnArtifact(workspacePath, {
        conversationId: conversation.id,
        step: conversation.currentStep,
        profileId: event.profileId ?? "agent",
        content,
      });
      return written.relativePath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.conversationStore.update(workspacePath, conversation.id, { status: "failed" });
      await this.eventStore.append(workspacePath, {
        type: "orchestration_step",
        message: "Pair negotiation failed to write legacy message artifact",
        conversationId: conversation.id,
        parentEventId: event.id,
        profileId: event.profileId,
        status: "failed",
        error: message,
      });
      return WAITING_ARTIFACT;
    }
  }

  private async pausePairNegotiationAtLimit(
    workspacePath: string,
    conversation: AgentConversation,
    event: AgentHubEvent,
  ): Promise<void> {
    await this.conversationStore.update(workspacePath, conversation.id, { status: "paused" });
    await this.eventStore.append(workspacePath, {
      type: "orchestration_step",
      message: "Pair negotiation paused because max rounds were reached",
      conversationId: conversation.id,
      parentEventId: event.id,
      profileId: event.profileId,
      status: "paused",
    });
  }

  private async handleRoundtableOutput(
    workspacePath: string,
    conversation: AgentConversation,
    event: AgentHubEvent,
  ): Promise<void> {
    if (conversation.status !== "running" || !conversation.participantProfileIds.includes(event.profileId ?? "")) {
      return;
    }

    const currentSpeaker = this.roundtableSpeakerForStep(conversation, conversation.currentStep);
    if (event.profileId !== currentSpeaker) {
      return;
    }

    if (conversation.maxSteps !== null && conversation.currentStep >= conversation.maxSteps) {
      await this.conversationStore.update(workspacePath, conversation.id, { status: "completed" });
      await this.eventStore.append(workspacePath, {
        type: "orchestration_step",
        message: event.message ?? "Roundtable completed",
        conversationId: conversation.id,
        parentEventId: event.id,
        profileId: event.profileId,
        status: "completed",
      });
      return;
    }

    const nextStep = conversation.currentStep + 1;
    const nextProfileId = this.roundtableSpeakerForStep(conversation, nextStep);
    const nextSession = this.findOnlineSession(workspacePath, nextProfileId);
    if (!nextSession) {
      await this.eventStore.append(workspacePath, {
        type: "agent_forward",
        message: event.message,
        conversationId: conversation.id,
        parentEventId: event.id,
        profileId: event.profileId,
        targetProfileId: nextProfileId,
        targetProfileIds: [nextProfileId],
        deliveryStatus: "failed",
        error: `No online session for profile ${nextProfileId}`,
      });
      await this.conversationStore.update(workspacePath, conversation.id, { status: "failed" });
      return;
    }

    this.sessions.write(nextSession.sessionId, this.toTerminalInput(this.buildRoundtableTurnPrompt(conversation, event, nextStep), nextProfileId));
    await this.conversationStore.update(workspacePath, conversation.id, { currentStep: nextStep });
    await this.eventStore.append(workspacePath, {
      type: "agent_forward",
      message: event.message,
      conversationId: conversation.id,
      parentEventId: event.id,
      profileId: event.profileId,
      sessionId: nextSession.sessionId,
      targetProfileId: nextProfileId,
      targetProfileIds: [nextProfileId],
      deliveryStatus: "sent",
    });
  }

  private async handleSupervisorOutput(
    workspacePath: string,
    conversation: AgentConversation,
    event: AgentHubEvent,
  ): Promise<void> {
    const parsed = parseAgentHubCommands(event.message ?? "");
    if (parsed.errors.length > 0) {
      for (const error of parsed.errors) {
        await this.eventStore.append(workspacePath, {
          type: "orchestration_step",
          message: error.message,
          conversationId: conversation.id,
          parentEventId: event.id,
          profileId: event.profileId,
          status: "parse_error",
          error: error.message,
          metadata: { agenthubParseError: error },
        });
      }
      if (parsed.commands.length === 0) {
        return;
      }
    }
    for (const command of parsed.commands) {
      const current = await this.findConversation(workspacePath, conversation.id);
      if (!current || current.status !== "running") {
        return;
      }

      if (command.action === "done") {
        await this.completeConversation(workspacePath, current, event, command);
        continue;
      }
      if (command.action === "ask_user") {
        await this.pauseForUser(workspacePath, current, event, command);
        continue;
      }
      if (command.action !== "send") {
        continue;
      }

      if (!current || (await this.isDeliveryBlocked(workspacePath, current))) {
        return;
      }

      if (!current.participantProfileIds.includes(command.target)) {
        await this.eventStore.append(workspacePath, {
          type: "agent_forward",
          message: command.message,
          conversationId: current.id,
          taskId: command.task_id,
          parentEventId: event.id,
          profileId: event.profileId,
          targetProfileId: command.target,
          targetProfileIds: [command.target],
          deliveryStatus: "failed",
          error: `Profile ${command.target} is not a participant in conversation ${current.id}`,
          metadata: { agenthubCommand: command },
        });
        return;
      }

      const targetSession = this.findOnlineSession(workspacePath, command.target);
      if (!targetSession) {
        await this.eventStore.append(workspacePath, {
          type: "agent_forward",
          message: command.message,
          conversationId: current.id,
          taskId: command.task_id,
          parentEventId: event.id,
          profileId: event.profileId,
          targetProfileId: command.target,
          targetProfileIds: [command.target],
          deliveryStatus: "failed",
          error: `No online session for profile ${command.target}`,
          metadata: { agenthubCommand: command },
        });
        await this.conversationStore.update(workspacePath, current.id, { status: "failed" });
        return;
      }

      this.sessions.write(
        targetSession.sessionId,
        this.toTerminalInput(this.buildDelegatedTaskPrompt(current, command), command.target),
      );
      await this.recordDeliveryStep(workspacePath, current);
      await this.eventStore.append(workspacePath, {
        type: "agent_forward",
        message: command.message,
        conversationId: current.id,
        taskId: command.task_id,
        parentEventId: event.id,
        profileId: event.profileId,
        sessionId: targetSession.sessionId,
        targetProfileId: command.target,
        targetProfileIds: [command.target],
        deliveryStatus: "sent",
        metadata: { agenthubCommand: command },
      });
    }
  }

  private async handleParticipantOutput(
    workspacePath: string,
    conversation: AgentConversation,
    event: AgentHubEvent,
  ): Promise<void> {
    if (!event.taskId || !conversation.supervisorProfileId) {
      return;
    }

    const matchingForward = (await this.eventStore.list(workspacePath)).some(
      (candidate) =>
        candidate.type === "agent_forward" &&
        candidate.deliveryStatus === "sent" &&
        candidate.conversationId === conversation.id &&
        candidate.taskId === event.taskId &&
        candidate.targetProfileId === event.profileId,
    );
    if (!matchingForward) {
      return;
    }

    const alreadyObserved = (await this.eventStore.list(workspacePath)).some(
      (candidate) =>
        candidate.type === "agent_forward" &&
        candidate.deliveryStatus === "observed" &&
        candidate.conversationId === conversation.id &&
        candidate.taskId === event.taskId &&
        candidate.profileId === event.profileId,
    );
    if (alreadyObserved) {
      return;
    }

    const current = await this.findConversation(workspacePath, conversation.id);
    if (!current || (await this.isDeliveryBlocked(workspacePath, current))) {
      return;
    }

    const supervisorSession = this.findOnlineSession(workspacePath, conversation.supervisorProfileId);
    if (!supervisorSession) {
      await this.conversationStore.update(workspacePath, conversation.id, { status: "failed" });
      return;
    }

    this.sessions.write(
      supervisorSession.sessionId,
      this.toTerminalInput(this.buildObservationPrompt(event), conversation.supervisorProfileId),
    );
    await this.recordDeliveryStep(workspacePath, current);
    await this.eventStore.append(workspacePath, {
      type: "agent_forward",
      message: event.message,
      conversationId: conversation.id,
      taskId: event.taskId,
      parentEventId: event.id,
      profileId: event.profileId,
      sessionId: supervisorSession.sessionId,
      targetProfileId: conversation.supervisorProfileId,
      targetProfileIds: [conversation.supervisorProfileId],
      deliveryStatus: "observed",
    });
  }

  private async completeConversation(
    workspacePath: string,
    conversation: AgentConversation,
    event: AgentHubEvent,
    command: Extract<AgentHubCommand, { action: "done" }>,
  ): Promise<void> {
    await this.conversationStore.update(workspacePath, conversation.id, { status: "completed" });
    await this.eventStore.append(workspacePath, {
      type: "orchestration_step",
      message: command.message ?? "Conversation completed",
      conversationId: conversation.id,
      parentEventId: event.id,
      profileId: event.profileId,
      status: "completed",
      metadata: { agenthubCommand: command },
    });
  }

  private async pauseForUser(
    workspacePath: string,
    conversation: AgentConversation,
    event: AgentHubEvent,
    command: Extract<AgentHubCommand, { action: "ask_user" }>,
  ): Promise<void> {
    await this.conversationStore.update(workspacePath, conversation.id, { status: "paused" });
    await this.eventStore.append(workspacePath, {
      type: "orchestration_step",
      message: command.message,
      conversationId: conversation.id,
      parentEventId: event.id,
      profileId: event.profileId,
      status: "paused",
      metadata: { agenthubCommand: command },
    });
  }

  private async findConversation(workspacePath: string, conversationId: string): Promise<AgentConversation | undefined> {
    return (await this.conversationStore.list(workspacePath)).find((conversation) => conversation.id === conversationId);
  }

  private async isDeliveryBlocked(workspacePath: string, conversation: AgentConversation): Promise<boolean> {
    if (conversation.status !== "running") {
      return true;
    }

    if (!this.hasReachedMaxSteps(conversation)) {
      return false;
    }

    await this.conversationStore.update(workspacePath, conversation.id, { status: "paused" });
    await this.eventStore.append(workspacePath, {
      type: "orchestration_step",
      message: "Conversation paused because max steps were reached",
      conversationId: conversation.id,
      status: "paused",
    });
    return true;
  }

  private async recordDeliveryStep(
    workspacePath: string,
    conversation: AgentConversation,
  ): Promise<AgentConversation> {
    const currentStep = conversation.currentStep + 1;
    return this.conversationStore.update(workspacePath, conversation.id, {
      currentStep,
      status: this.hasReachedMaxSteps({ ...conversation, currentStep }) ? "paused" : conversation.status,
    });
  }

  private async recordPairNegotiationDeliveryStep(
    workspacePath: string,
    conversation: AgentConversation,
  ): Promise<AgentConversation> {
    return this.conversationStore.update(workspacePath, conversation.id, {
      currentStep: conversation.currentStep + 1,
      status: conversation.status,
    });
  }

  private hasReachedMaxSteps(conversation: AgentConversation): boolean {
    return conversation.maxSteps !== null && conversation.currentStep >= conversation.maxSteps;
  }

  private findOnlineSession(workspacePath: string, profileId: string): ConversationSession | undefined {
    return this.sessions
      .listSessions()
      .find(
        (candidate) =>
          candidate.status === "online" &&
          candidate.profileId === profileId &&
          candidate.workspacePath === workspacePath,
      );
  }

  private roundtableSpeakerForStep(conversation: AgentConversation, step: number): string {
    const index = Math.max(0, step - 1) % conversation.participantProfileIds.length;
    return conversation.participantProfileIds[index];
  }

  private pairNegotiationSpeakerForStep(conversation: AgentConversation, step: number): string {
    const index = Math.max(0, step - 1) % conversation.participantProfileIds.length;
    return conversation.participantProfileIds[index];
  }

  private otherPairNegotiationParticipant(conversation: AgentConversation, profileId: string): string | null {
    return conversation.participantProfileIds.find((participantProfileId) => participantProfileId !== profileId) ?? null;
  }

  private async pairNegotiationAcceptedProfiles(
    workspacePath: string,
    conversationId: string,
    proposalVersion: number,
  ): Promise<Set<string>> {
    const acceptedProfiles = new Set<string>();
    for (const event of await this.eventStore.list(workspacePath)) {
      const pairNegotiation = event.metadata?.pairNegotiation;
      if (
        event.conversationId === conversationId &&
        event.status === "accepted" &&
        typeof pairNegotiation === "object" &&
        pairNegotiation !== null &&
        !Array.isArray(pairNegotiation)
      ) {
        const acceptedBy = (pairNegotiation as Record<string, unknown>).acceptedBy;
        const acceptedProposalVersion = (pairNegotiation as Record<string, unknown>).proposalVersion;
        if (typeof acceptedBy === "string" && acceptedProposalVersion === proposalVersion) {
          acceptedProfiles.add(acceptedBy);
        }
      }
    }
    return acceptedProfiles;
  }

  private buildInitialManagerPrompt(conversation: AgentConversation): string {
    return [
      "AgentHub manager conversation.",
      `Conversation: ${conversation.id}`,
      `Topic: ${conversation.topic}`,
      `Participants: ${conversation.participantProfileIds.join(", ")}`,
      "Delegate work with exactly this command format when another agent should act:",
      '<agenthub>{"action":"send","target":"codex","task_id":"T-001","message":"Task details"}</agenthub>',
      "Wait for observations before sending the next task.",
    ].join("\r\n");
  }

  private buildInitialRoundtablePrompt(conversation: AgentConversation): string {
    return [
      "AgentHub roundtable conversation.",
      `Conversation: ${conversation.id}`,
      `Topic: ${conversation.topic}`,
      `Participants: ${conversation.participantProfileIds.join(" -> ")}`,
      "You are the first speaker. Give a concise proposal, then stop and wait.",
    ].join("\r\n");
  }

  private buildInitialPairNegotiationPrompt(
    workspacePath: string,
    conversation: AgentConversation,
    paths: { briefPath: string; memoryPath: string; outputPath: string },
  ): Promise<string> {
    return loadAndRenderPairPromptTemplate(workspacePath, "initial", {
      topic: conversation.topic,
      brief_path: paths.briefPath,
      memory_path: paths.memoryPath,
      output_path: paths.outputPath,
    });
  }

  private buildDelegatedTaskPrompt(
    conversation: AgentConversation,
    command: Extract<AgentHubCommand, { action: "send" }>,
  ): string {
    return [
      "AgentHub delegated task.",
      `Conversation: ${conversation.id}`,
      `Task: ${command.task_id}`,
      "",
      command.message,
    ].join("\r\n");
  }

  private buildRoundtableTurnPrompt(conversation: AgentConversation, event: AgentHubEvent, nextStep: number): string {
    const isSummaryTurn = conversation.maxSteps !== null && nextStep >= conversation.maxSteps;
    return [
      "AgentHub roundtable conversation.",
      `Conversation: ${conversation.id}`,
      `Topic: ${conversation.topic}`,
      `Previous speaker: ${event.profileId ?? "agent"}`,
      event.message ?? "",
      isSummaryTurn
        ? "请给出最终总结，包含共识、分歧和下一步行动。"
        : "Please respond with your view, keep it bounded, then stop and wait.",
    ].join("\r\n");
  }

  private buildPairNegotiationTurnPrompt(
    workspacePath: string,
    conversation: AgentConversation,
    event: AgentHubEvent,
    command: Extract<AgentHubCommand, { action: "continue" }>,
    targetProfileId: string,
    previousArtifactPath: string | null,
  ): Promise<string> {
    const paths = this.artifacts.paths(conversation.id);
    const outputPath = this.artifacts.turnArtifactPath(conversation.id, conversation.currentStep + 1, targetProfileId);
    return loadAndRenderPairPromptTemplate(workspacePath, "turn", {
      topic: conversation.topic,
      brief_path: paths.briefPath,
      memory_path: paths.memoryPath,
      previous_profile: event.profileId ?? "agent",
      previous_artifact_path: previousArtifactPath ?? "",
      output_path: outputPath,
      next_profile: targetProfileId,
      summary: command.summary,
      message: previousArtifactPath ? command.message ?? "" : buildPairNegotiationTurnBody(event.message ?? "", command.message ?? ""),
      proposal_version: command.proposal_version,
      next_proposal_version: command.proposal_version + 1,
    });
  }

  private buildPairNegotiationAcceptancePrompt(
    workspacePath: string,
    conversation: AgentConversation,
    event: AgentHubEvent,
    command: Extract<AgentHubCommand, { action: "accept" }>,
    targetProfileId: string,
    previousArtifactPath: string | null,
  ): Promise<string> {
    const paths = this.artifacts.paths(conversation.id);
    const outputPath = this.artifacts.turnArtifactPath(conversation.id, conversation.currentStep + 1, targetProfileId);
    return loadAndRenderPairPromptTemplate(workspacePath, "acceptance", {
      topic: conversation.topic,
      brief_path: paths.briefPath,
      memory_path: paths.memoryPath,
      previous_profile: event.profileId ?? "agent",
      previous_artifact_path: previousArtifactPath ?? "",
      output_path: outputPath,
      next_profile: targetProfileId,
      summary: command.summary,
      proposal_version: command.proposal_version,
      next_proposal_version: command.proposal_version + 1,
    });
  }

  private buildObservationPrompt(event: AgentHubEvent): string {
    return [
      `Observation from ${event.profileId ?? "agent"}.`,
      `Task: ${event.taskId ?? "unknown"}`,
      event.message ?? "",
      "Continue the manager conversation with the next bounded step or a done command.",
    ].join("\r\n");
  }

  private toTerminalInput(message: string, _targetProfileId?: string): string {
    return toSubmittedTerminalInput(message);
  }
}

function normalizeRoundtableParticipants(participantProfileIds: string[]): string[] {
  const uniqueProfileIds = [...new Set(participantProfileIds)];
  return uniqueProfileIds.sort((left, right) => {
    const leftIndex = ROUNDTABLE_PROFILE_ORDER.indexOf(left);
    const rightIndex = ROUNDTABLE_PROFILE_ORDER.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) {
      return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
        (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
    }
    return participantProfileIds.indexOf(left) - participantProfileIds.indexOf(right);
  });
}

function normalizePairNegotiationParticipants(participantProfileIds: string[]): string[] {
  const uniqueProfileIds = [...new Set(participantProfileIds)];
  if (uniqueProfileIds.length !== 2) {
    throw new Error("Pair negotiation requires exactly two participants");
  }
  return uniqueProfileIds;
}

function buildPairNegotiationTurnBody(eventMessage: string, commandMessage: string): string {
  const visibleMessage = stripAgentHubCommandBlocks(eventMessage).trim();
  const reviewMessage = commandMessage.trim();
  if (!visibleMessage) {
    return reviewMessage;
  }
  if (!reviewMessage || visibleMessage.includes(reviewMessage)) {
    return visibleMessage;
  }
  return [visibleMessage, "对方给你的审查要求：", reviewMessage].join("\r\n\r\n");
}

function pairNegotiationCommandSummary(
  command: Extract<AgentHubCommand, { action: "continue" | "accept" }>,
  event: AgentHubEvent,
): string | undefined {
  if (command.summary) {
    return command.summary;
  }
  if ("message" in command) {
    return command.message ?? event.message;
  }
  return event.message;
}

function stripAgentHubCommandBlocks(message: string): string {
  return message.replace(/<agenthub>[\s\S]*?<\/agenthub>/g, "").trim();
}
