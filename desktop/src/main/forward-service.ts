import { EventStore } from "./event-store";
import { ForwardStore, type AgentForward, type CreateForwardInput } from "./forward-store";

export type ForwardSession = {
  sessionId: string;
  profileId: string;
  workspacePath: string;
  status: "online" | "exited";
};

export type ForwardSessionGateway = {
  listSessions(): ForwardSession[];
  write(sessionId: string, data: string): void;
};

export class ForwardService {
  constructor(
    private readonly forwardStore = new ForwardStore(),
    private readonly eventStore = new EventStore(),
    private readonly sessions: ForwardSessionGateway,
  ) {}

  async create(workspacePath: string, input: CreateForwardInput): Promise<AgentForward> {
    const forward = await this.forwardStore.create(workspacePath, input);
    await this.appendForwardEvent(workspacePath, forward, "Forward created");
    return forward;
  }

  list(workspacePath: string): Promise<AgentForward[]> {
    return this.forwardStore.list(workspacePath);
  }

  async pause(workspacePath: string, forwardId: string): Promise<AgentForward> {
    const forward = await this.forwardStore.update(workspacePath, forwardId, {
      status: "paused",
      lastError: null,
    });
    await this.appendForwardEvent(workspacePath, forward, "Forward paused");
    return forward;
  }

  async stop(workspacePath: string, forwardId: string): Promise<AgentForward> {
    const forward = await this.forwardStore.update(workspacePath, forwardId, {
      status: "stopped",
      lastError: null,
    });
    await this.appendForwardEvent(workspacePath, forward, "Forward stopped");
    return forward;
  }

  async send(workspacePath: string, forwardId: string): Promise<AgentForward> {
    const forward = (await this.forwardStore.list(workspacePath)).find((candidate) => candidate.id === forwardId);
    if (!forward) {
      throw new Error(`Unknown forward: ${forwardId}`);
    }
    if (forward.status === "stopped") {
      const stopped = await this.forwardStore.update(workspacePath, forward.id, {
        lastError: "Forward is stopped",
      });
      await this.appendForwardEvent(workspacePath, stopped, "Forward is stopped");
      return stopped;
    }

    const session = this.sessions
      .listSessions()
      .find(
        (candidate) =>
          candidate.status === "online" &&
          candidate.profileId === forward.targetProfileId &&
          candidate.workspacePath === workspacePath,
      );
    if (!session) {
      const blocked = await this.forwardStore.update(workspacePath, forward.id, {
        status: "blocked",
        sessionId: null,
        lastError: `No online session for profile ${forward.targetProfileId}`,
      });
      await this.appendForwardEvent(workspacePath, blocked, "Forward blocked: target session is offline");
      return blocked;
    }

    this.sessions.write(session.sessionId, this.toTerminalInput(forward.message));
    const sent = await this.forwardStore.update(workspacePath, forward.id, {
      status: "sent",
      sessionId: session.sessionId,
      lastError: null,
      sentAt: new Date().toISOString(),
    });
    await this.appendForwardEvent(workspacePath, sent, "Forward sent");
    return sent;
  }

  private toTerminalInput(message: string): string {
    return message.endsWith("\r") || message.endsWith("\n") ? message : `${message}\r`;
  }

  private async appendForwardEvent(workspacePath: string, forward: AgentForward, message: string): Promise<void> {
    await this.eventStore.append(workspacePath, {
      type: "agent_forward",
      message,
      targetProfileId: forward.targetProfileId,
      profileId: forward.sourceProfileId ?? undefined,
      sessionId: forward.sessionId ?? undefined,
      status: forward.status,
      error: forward.lastError ?? undefined,
      metadata: {
        forwardId: forward.id,
        sourceProfileId: forward.sourceProfileId,
      },
    });
  }
}
