import { parseAgentHubCommands, type AgentHubCommand } from "./agent-command-parser";
import { EventStore, type AgentHubEvent } from "./event-store";
import { TaskStore } from "./task-store";
import { TeamStore, type TeamMailboxMessage } from "./team-store";
import { toSubmittedTerminalInput } from "./terminal-input";

const DEFAULT_TEAM_ID = "default";

export type TeamCommandSession = {
  sessionId: string;
  profileId: string;
  workspacePath: string;
  status: "online" | "exited";
};

export type TeamCommandSessionGateway = {
  listSessions(): TeamCommandSession[];
  write(sessionId: string, data: string): void;
};

export class TeamCommandService {
  constructor(
    private readonly teamStore = new TeamStore(),
    private readonly taskStore = new TaskStore(),
    private readonly eventStore = new EventStore(),
    private readonly sessions: TeamCommandSessionGateway,
  ) {}

  async handleAgentOutput(workspacePath: string, event: AgentHubEvent): Promise<void> {
    if (event.type !== "agent_output" || !event.profileId || !event.message) {
      return;
    }

    const parsed = parseAgentHubCommands(event.message);
    for (const error of parsed.errors) {
      await this.eventStore.append(workspacePath, {
        type: "error",
        profileId: event.profileId,
        parentEventId: event.id,
        message: error.message,
        error: error.message,
        metadata: { agenthubParseError: error },
      });
    }

    for (const command of parsed.commands) {
      if (command.action === "send_message") {
        await this.handleSendMessage(workspacePath, event, command);
        continue;
      }
      if (command.action === "claim_task") {
        await this.handleClaimTask(workspacePath, event, command);
        continue;
      }
      if (command.action === "complete_task") {
        await this.handleCompleteTask(workspacePath, event, command);
      }
    }
  }

  private async handleSendMessage(
    workspacePath: string,
    event: AgentHubEvent,
    command: Extract<AgentHubCommand, { action: "send_message" }>,
  ): Promise<void> {
    const teamId = this.teamIdFor(event, command.team_id);
    const taskId = command.task_id ?? event.taskId ?? null;
    const conversationId = command.conversation_id ?? event.conversationId ?? null;
    await this.teamStore.ensureTeam(workspacePath, {
      id: teamId,
      name: teamId === DEFAULT_TEAM_ID ? "Default Team" : teamId,
      memberProfileIds: [...new Set([event.profileId ?? "", command.to].filter(Boolean))],
    });
    const targetSession = this.findOnlineSession(workspacePath, command.to);
    if (!targetSession) {
      const mailbox = await this.teamStore.appendMailbox(workspacePath, {
        teamId,
        action: "send_message",
        fromProfileId: event.profileId!,
        toProfileId: command.to,
        message: command.message,
        taskId,
        conversationId,
        status: "failed",
        error: `No online session for profile ${command.to}`,
      });
      await this.appendForwardEvent(workspacePath, event, command, mailbox, "failed");
      return;
    }

    this.sessions.write(
      targetSession.sessionId,
      toSubmittedTerminalInput(this.buildTeamMessagePrompt(teamId, event.profileId!, command, taskId, conversationId)),
    );
    const mailbox = await this.teamStore.appendMailbox(workspacePath, {
      teamId,
      action: "send_message",
      fromProfileId: event.profileId!,
      toProfileId: command.to,
      message: command.message,
      taskId,
      conversationId,
      status: "sent",
      sessionId: targetSession.sessionId,
    });
    await this.appendForwardEvent(workspacePath, event, command, mailbox, "sent");
  }

  private async handleClaimTask(
    workspacePath: string,
    event: AgentHubEvent,
    command: Extract<AgentHubCommand, { action: "claim_task" }>,
  ): Promise<void> {
    const teamId = this.teamIdFor(event, command.team_id);
    const updated = await this.taskStore.update(workspacePath, command.task_id, {
      status: "running",
      profileId: event.profileId!,
    });
    await this.teamStore.appendMailbox(workspacePath, {
      teamId,
      action: "claim_task",
      fromProfileId: event.profileId!,
      taskId: command.task_id,
      status: "observed",
      message: `Task claimed: ${updated.title}`,
    });
    await this.eventStore.append(workspacePath, {
      type: "task_updated",
      profileId: event.profileId,
      taskId: updated.id,
      status: updated.status,
      message: updated.title,
      metadata: { teamId, agenthubCommand: command },
    });
  }

  private async handleCompleteTask(
    workspacePath: string,
    event: AgentHubEvent,
    command: Extract<AgentHubCommand, { action: "complete_task" }>,
  ): Promise<void> {
    const teamId = this.teamIdFor(event, command.team_id);
    const updated = await this.taskStore.update(workspacePath, command.task_id, {
      status: "done",
      profileId: event.profileId!,
    });
    const summary = command.summary ?? updated.title;
    await this.teamStore.appendMailbox(workspacePath, {
      teamId,
      action: "complete_task",
      fromProfileId: event.profileId!,
      taskId: command.task_id,
      status: "observed",
      message: summary,
    });
    await this.eventStore.append(workspacePath, {
      type: "task_updated",
      profileId: event.profileId,
      taskId: updated.id,
      status: updated.status,
      message: summary,
      metadata: { teamId, agenthubCommand: command },
    });
  }

  private teamIdFor(event: AgentHubEvent, commandTeamId?: string): string {
    const metadataTeamId = event.metadata?.teamId;
    return commandTeamId ?? (typeof metadataTeamId === "string" ? metadataTeamId : DEFAULT_TEAM_ID);
  }

  private findOnlineSession(workspacePath: string, profileId: string): TeamCommandSession | undefined {
    return this.sessions
      .listSessions()
      .find(
        (session) =>
          session.status === "online" &&
          session.profileId === profileId &&
          session.workspacePath === workspacePath,
      );
  }

  private buildTeamMessagePrompt(
    teamId: string,
    fromProfileId: string,
    command: Extract<AgentHubCommand, { action: "send_message" }>,
    taskId: string | null,
    conversationId: string | null,
  ): string {
    return [
      "AgentHub team message.",
      `Team: ${teamId}`,
      `From: ${fromProfileId}`,
      conversationId ? `Conversation: ${conversationId}` : null,
      taskId ? `Task: ${taskId}` : null,
      "",
      command.message,
      "",
      "When you are finished, return a concise result. You may use <agenthub>{...}</agenthub> commands to message teammates or update tasks.",
    ]
      .filter((line): line is string => line !== null)
      .join("\r\n");
  }

  private async appendForwardEvent(
    workspacePath: string,
    sourceEvent: AgentHubEvent,
    command: Extract<AgentHubCommand, { action: "send_message" }>,
    mailbox: TeamMailboxMessage,
    deliveryStatus: "sent" | "failed",
  ): Promise<void> {
    await this.eventStore.append(workspacePath, {
      type: "agent_forward",
      profileId: sourceEvent.profileId,
      targetProfileId: command.to,
      targetProfileIds: [command.to],
      sessionId: mailbox.sessionId ?? undefined,
      taskId: mailbox.taskId ?? undefined,
      conversationId: mailbox.conversationId ?? undefined,
      parentEventId: sourceEvent.id,
      deliveryStatus,
      error: mailbox.error ?? undefined,
      message: command.message,
      metadata: {
        teamId: mailbox.teamId,
        mailboxId: mailbox.id,
        agenthubCommand: command,
      },
    });
  }
}
