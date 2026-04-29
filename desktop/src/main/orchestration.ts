import { EventStore } from "./event-store";
import { TaskStore, type AgentTask } from "./task-store";

export type OrchestrationSession = {
  sessionId: string;
  profileId: string;
  workspacePath: string;
  status: "online" | "exited";
};

export type OrchestrationSessionGateway = {
  listSessions(): OrchestrationSession[];
  write(sessionId: string, data: string): void;
};

export type StartOrchestrationInput = {
  workspacePath: string;
  goal: string;
  plannerProfileId?: string;
  implementerProfileId?: string;
  reviewerProfileId?: string;
  rolePrompts?: Record<string, string>;
};

export type OrchestrationResult = {
  tasks: AgentTask[];
};

export class OrchestrationService {
  constructor(
    private readonly taskStore = new TaskStore(),
    private readonly eventStore = new EventStore(),
    private readonly sessions?: OrchestrationSessionGateway,
  ) {}

  async start(input: StartOrchestrationInput): Promise<OrchestrationResult> {
    const planner = await this.taskStore.create(input.workspacePath, {
      title: "Plan work",
      description: input.goal,
      status: "pending",
      profileId: input.plannerProfileId ?? "claude",
      runId: null,
    });
    const implementer = await this.taskStore.create(input.workspacePath, {
      title: "Implement work",
      description: input.goal,
      status: "pending",
      profileId: input.implementerProfileId ?? "codex",
      runId: null,
    });
    const reviewer = await this.taskStore.create(input.workspacePath, {
      title: "Review work",
      description: input.goal,
      status: "pending",
      profileId: input.reviewerProfileId ?? "gemini",
      runId: null,
    });

    const tasks = [planner, implementer, reviewer];
    for (const [index, task] of tasks.entries()) {
      await this.eventStore.append(input.workspacePath, {
        type: "task_created",
        taskId: task.id,
        profileId: task.profileId ?? undefined,
        status: task.status,
        message: task.title,
      });
      await this.eventStore.append(input.workspacePath, {
        type: "orchestration_step",
        taskId: task.id,
        profileId: task.profileId ?? undefined,
        status: "queued",
        message: `Queued ${task.title}`,
        metadata: { autoExecute: false },
      });
      if (index === 0) {
        await this.sendRolePrompt(input.workspacePath, input.goal, task, input.rolePrompts?.[task.profileId ?? ""]);
      } else {
        await this.appendWaitingPreviousStep(input.workspacePath, task);
      }
    }

    return { tasks };
  }

  private async sendRolePrompt(
    workspacePath: string,
    goal: string,
    task: AgentTask,
    rolePrompt?: string,
  ): Promise<void> {
    if (!this.sessions || !task.profileId) {
      await this.appendWaitingSession(workspacePath, task);
      return;
    }

    const session = this.sessions
      .listSessions()
      .find(
        (candidate) =>
          candidate.status === "online" &&
          candidate.profileId === task.profileId &&
          candidate.workspacePath === workspacePath,
      );
    if (!session) {
      await this.appendWaitingSession(workspacePath, task);
      return;
    }

    this.sessions.write(session.sessionId, this.buildPrompt(goal, task, rolePrompt));
    await this.eventStore.append(workspacePath, {
      type: "orchestration_step",
      taskId: task.id,
      profileId: task.profileId,
      sessionId: session.sessionId,
      status: "prompt_sent",
      message: `Sent prompt for ${task.title}`,
      metadata: { autoExecute: false },
    });
  }

  private async appendWaitingSession(workspacePath: string, task: AgentTask): Promise<void> {
    await this.eventStore.append(workspacePath, {
      type: "orchestration_step",
      taskId: task.id,
      profileId: task.profileId ?? undefined,
      status: "waiting_session",
      message: `Waiting for online session: ${task.profileId ?? "unassigned"}`,
      metadata: { autoExecute: false },
    });
  }

  private async appendWaitingPreviousStep(workspacePath: string, task: AgentTask): Promise<void> {
    await this.eventStore.append(workspacePath, {
      type: "orchestration_step",
      taskId: task.id,
      profileId: task.profileId ?? undefined,
      status: "waiting_previous_step",
      message: `Waiting for previous step before ${task.title}`,
      metadata: { autoExecute: false },
    });
  }

  private buildPrompt(goal: string, task: AgentTask, rolePrompt?: string): string {
    const lines = [
      "AgentHub controlled orchestration step.",
      `Role: ${this.roleName(task.title)}`,
      `Task: ${task.title}`,
      `Goal: ${goal}`,
      "Produce one bounded response for this step. Do not start additional agent-to-agent loops.",
    ];
    const trimmedRolePrompt = rolePrompt?.trim();
    if (trimmedRolePrompt) {
      lines.push("Profile instructions:", trimmedRolePrompt);
    }
    lines.push("");
    return lines.join("\r\n");
  }

  private roleName(title: string): string {
    if (title.toLowerCase().startsWith("plan")) {
      return "planner";
    }
    if (title.toLowerCase().startsWith("implement")) {
      return "implementer";
    }
    return "reviewer";
  }
}
