import path from "node:path";
import { parseAgentHubCommands, type AgentHubCommand } from "./agent-command-parser";
import { EventStore, type AgentHubEvent } from "./event-store";
import {
  TaskPlanStore,
  type CreateTaskPlanInput,
  type TaskPlan,
  type TaskPlanTask,
} from "./task-plan-store";
import { toSubmittedTerminalInput } from "./terminal-input";

export type TaskPlanSession = {
  sessionId: string;
  profileId: string;
  workspacePath: string;
  status: "online" | "exited";
};

export type TaskPlanSessionGateway = {
  listSessions(): TaskPlanSession[];
  write(sessionId: string, data: string): void;
};

export type HookObserver = [name: string, observer: () => Promise<void> | void | undefined];

export async function observeHookEvent(
  workspacePath: string,
  _event: AgentHubEvent,
  observers: HookObserver[],
): Promise<void> {
  for (const [name, observer] of observers) {
    try {
      await observer();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[agenthub:${name}] hook observation failed workspace=${workspacePath}: ${message}`);
    }
  }
}

export type StartTaskPlanManagerInput = {
  planId: string;
};

export type HookCompletionInput = {
  planId: string;
  taskId: string;
  profileId: string;
  message: string;
  sessionId?: string;
  runId?: string;
  sourceEventId?: string;
};

type ManagerCommand =
  | Extract<AgentHubCommand, { action: "assign_task" }>
  | Extract<AgentHubCommand, { action: "approve_task" }>
  | Extract<AgentHubCommand, { action: "reject_task" }>
  | Extract<AgentHubCommand, { action: "request_review" }>
  | Extract<AgentHubCommand, { action: "pause_plan" }>;

type RoutedCommand =
  | Extract<AgentHubCommand, { action: "assign_task" }>
  | Extract<AgentHubCommand, { action: "reject_task" }>
  | Extract<AgentHubCommand, { action: "request_review" }>;

export class TaskPlanService {
  constructor(
    private readonly taskPlanStore: TaskPlanStore,
    private readonly eventStore: EventStore,
    private readonly sessions: TaskPlanSessionGateway,
  ) {}

  async createPlan(workspacePath: string, input: CreateTaskPlanInput): Promise<TaskPlan> {
    const plan = await this.taskPlanStore.createPlan(workspacePath, input);
    await this.taskPlanStore.appendEvent(workspacePath, plan.id, {
      type: "created",
      message: plan.title,
      toProfileId: plan.managerProfileId,
    });
    return plan;
  }

  listPlans(workspacePath: string): Promise<TaskPlan[]> {
    return this.taskPlanStore.listPlans(workspacePath);
  }

  async startManager(workspacePath: string, input: StartTaskPlanManagerInput): Promise<TaskPlan> {
    const plan = await this.taskPlanStore.getPlan(workspacePath, input.planId);
    const managerSession = this.findOnlineSession(workspacePath, plan.managerProfileId);
    if (!managerSession) {
      const error = `No online session for profile ${plan.managerProfileId}`;
      await this.taskPlanStore.appendEvent(workspacePath, plan.id, {
        type: "delivery_failed",
        toProfileId: plan.managerProfileId,
        message: error,
      });
      await this.eventStore.append(workspacePath, {
        type: "orchestration_step",
        profileId: plan.managerProfileId,
        targetProfileId: plan.managerProfileId,
        targetProfileIds: [plan.managerProfileId],
        status: "failed",
        error,
        message: error,
        metadata: { planId: plan.id },
      });
      return plan;
    }

    const updatedPlan = await this.taskPlanStore.updatePlanStatus(workspacePath, plan.id, "running");
    this.sessions.write(managerSession.sessionId, toSubmittedTerminalInput(this.buildManagerPrompt(updatedPlan)));
    await this.taskPlanStore.appendEvent(workspacePath, plan.id, {
      type: "manager_started",
      toProfileId: plan.managerProfileId,
      sessionId: managerSession.sessionId,
      message: "Manager started",
    });
    await this.eventStore.append(workspacePath, {
      type: "orchestration_step",
      profileId: plan.managerProfileId,
      targetProfileId: plan.managerProfileId,
      targetProfileIds: [plan.managerProfileId],
      sessionId: managerSession.sessionId,
      status: "running",
      message: `Task plan manager started: ${plan.title}`,
      metadata: { planId: plan.id },
    });
    return updatedPlan;
  }

  async handleManagerCommand(
    workspacePath: string,
    fromProfileId: string,
    command: ManagerCommand,
    sourceEventId?: string,
  ): Promise<void> {
    const plan = await this.taskPlanStore.getPlan(workspacePath, command.plan_id);
    if (fromProfileId !== plan.managerProfileId) {
      await this.rejectUnauthorizedManagerCommand(workspacePath, plan, fromProfileId, command, sourceEventId);
      return;
    }

    if (command.action === "assign_task") {
      await this.routeTaskCommand(workspacePath, plan, fromProfileId, command, "assigned");
      return;
    }
    if (command.action === "request_review") {
      await this.routeTaskCommand(workspacePath, plan, fromProfileId, command, "review_requested");
      return;
    }
    if (command.action === "reject_task") {
      await this.routeTaskCommand(workspacePath, plan, fromProfileId, command, "rejected");
      return;
    }
    if (command.action === "approve_task") {
      await this.approveTask(workspacePath, plan, fromProfileId, command);
      return;
    }
    await this.pausePlan(workspacePath, plan, fromProfileId, command);
  }

  async handleHookCompletion(workspacePath: string, input: HookCompletionInput): Promise<void> {
    const plan = await this.taskPlanStore.getPlan(workspacePath, input.planId);
    if (input.sourceEventId && (await this.hasCompletedSourceEvent(workspacePath, plan.id, input.sourceEventId))) {
      return;
    }
    const artifact = await this.writeUniqueArtifact(workspacePath, input);
    await this.taskPlanStore.appendTask(workspacePath, plan.id, {
      id: input.taskId,
      title: input.taskId,
      status: "review",
      assigneeProfileId: input.profileId,
      attempt: await this.currentAttempt(workspacePath, plan.id, input.taskId),
      description: input.message,
      runId: input.runId ?? null,
      artifactPath: artifact.relativePath,
      updatedAt: new Date().toISOString(),
    });
    await this.taskPlanStore.appendEvent(workspacePath, plan.id, {
      type: "hook_completed",
      taskId: input.taskId,
      fromProfileId: input.profileId,
      toProfileId: plan.managerProfileId,
      message: input.message,
      artifactPath: artifact.relativePath,
      runId: input.runId,
      sessionId: input.sessionId,
      sourceEventId: input.sourceEventId,
    });

    const managerSession = this.findOnlineSession(workspacePath, plan.managerProfileId);
    if (!managerSession) {
      const error = `No online session for profile ${plan.managerProfileId}`;
      await this.taskPlanStore.appendEvent(workspacePath, plan.id, {
        type: "delivery_failed",
        taskId: input.taskId,
        fromProfileId: input.profileId,
        toProfileId: plan.managerProfileId,
        message: error,
        artifactPath: artifact.relativePath,
      });
      await this.eventStore.append(workspacePath, {
        type: "agent_forward",
        profileId: input.profileId,
        targetProfileId: plan.managerProfileId,
        targetProfileIds: [plan.managerProfileId],
        taskId: input.taskId,
        sessionId: input.sessionId,
        runId: input.runId,
        deliveryStatus: "failed",
        error,
        message: input.message,
        metadata: { planId: plan.id, artifactPath: artifact.relativePath },
      });
      return;
    }

    const prompt = this.buildHookObservationPrompt(plan, input, artifact.relativePath);
    this.sessions.write(managerSession.sessionId, toSubmittedTerminalInput(prompt));
    await this.eventStore.append(workspacePath, {
      type: "agent_forward",
      profileId: input.profileId,
      targetProfileId: plan.managerProfileId,
      targetProfileIds: [plan.managerProfileId],
      taskId: input.taskId,
      sessionId: managerSession.sessionId,
      runId: input.runId,
      deliveryStatus: "observed",
      message: input.message,
      metadata: { planId: plan.id, artifactPath: artifact.relativePath },
    });
  }

  async handleAgentOutput(workspacePath: string, event: AgentHubEvent): Promise<void> {
    if (event.type !== "agent_output") {
      return;
    }

    if (event.message) {
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
        if (isTaskPlanCommand(command)) {
          await this.handleManagerCommand(workspacePath, event.profileId ?? "agent", command, event.id);
        }
      }
    }

    const planId = typeof event.metadata?.planId === "string" ? event.metadata.planId : undefined;
    if (!planId) {
      return;
    }

    let plan: TaskPlan;
    try {
      plan = await this.taskPlanStore.getPlan(workspacePath, planId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.eventStore.append(workspacePath, {
        type: "error",
        profileId: event.profileId,
        parentEventId: event.id,
        message,
        error: message,
        metadata: { planId },
      });
      return;
    }

    if (!event.taskId || !event.profileId || !event.message) {
      await this.recordUnmatchedHook(workspacePath, plan, event);
      return;
    }

    if (event.profileId === plan.managerProfileId) {
      return;
    }

    await this.handleHookCompletion(workspacePath, {
      planId,
      taskId: event.taskId,
      profileId: event.profileId,
      message: event.message,
      sessionId: event.sessionId,
      runId: event.runId,
      sourceEventId: event.id,
    });
  }

  private async routeTaskCommand(
    workspacePath: string,
    plan: TaskPlan,
    fromProfileId: string,
    command: RoutedCommand,
    eventType: "assigned" | "review_requested" | "rejected",
  ): Promise<void> {
    const targetSession = this.findOnlineSession(workspacePath, command.to);
    if (!targetSession) {
      const error = `No online session for profile ${command.to}`;
      await this.taskPlanStore.appendEvent(workspacePath, plan.id, {
        type: "delivery_failed",
        taskId: command.task_id,
        fromProfileId,
        toProfileId: command.to,
        message: error,
      });
      await this.eventStore.append(workspacePath, {
        type: "agent_forward",
        profileId: fromProfileId,
        targetProfileId: command.to,
        targetProfileIds: [command.to],
        taskId: command.task_id,
        deliveryStatus: "failed",
        error,
        message: command.message,
        metadata: { planId: plan.id, agenthubCommand: command },
      });
      return;
    }

    await this.taskPlanStore.appendTask(workspacePath, plan.id, {
      id: command.task_id,
      title: command.task_id,
      status: "running",
      assigneeProfileId: command.to,
      attempt: await this.nextAttempt(workspacePath, plan.id, command.task_id),
      description: command.message,
      runId: null,
      updatedAt: new Date().toISOString(),
    });
    const prompt =
      command.action === "request_review"
        ? this.buildReviewPrompt(plan, fromProfileId, command)
        : this.buildTaskPrompt(plan, fromProfileId, command);
    this.sessions.write(targetSession.sessionId, toSubmittedTerminalInput(prompt));
    await this.taskPlanStore.appendEvent(workspacePath, plan.id, {
      type: eventType,
      taskId: command.task_id,
      fromProfileId,
      toProfileId: command.to,
      sessionId: targetSession.sessionId,
      message: command.message,
    });
    await this.eventStore.append(workspacePath, {
      type: "agent_forward",
      profileId: fromProfileId,
      targetProfileId: command.to,
      targetProfileIds: [command.to],
      taskId: command.task_id,
      sessionId: targetSession.sessionId,
      deliveryStatus: "sent",
      message: command.message,
      metadata: { planId: plan.id, agenthubCommand: command },
    });
  }

  private async approveTask(
    workspacePath: string,
    plan: TaskPlan,
    fromProfileId: string,
    command: Extract<AgentHubCommand, { action: "approve_task" }>,
  ): Promise<void> {
    await this.taskPlanStore.appendTask(workspacePath, plan.id, {
      id: command.task_id,
      title: command.task_id,
      status: "done",
      assigneeProfileId: null,
      attempt: await this.currentAttempt(workspacePath, plan.id, command.task_id),
      description: command.summary,
      updatedAt: new Date().toISOString(),
    });
    await this.taskPlanStore.appendEvent(workspacePath, plan.id, {
      type: "approved",
      taskId: command.task_id,
      fromProfileId,
      message: command.summary,
    });
  }

  private async pausePlan(
    workspacePath: string,
    plan: TaskPlan,
    fromProfileId: string,
    command: Extract<AgentHubCommand, { action: "pause_plan" }>,
  ): Promise<void> {
    await this.taskPlanStore.updatePlanStatus(workspacePath, plan.id, "paused");
    await this.taskPlanStore.appendEvent(workspacePath, plan.id, {
      type: "paused",
      fromProfileId,
      message: command.reason,
    });
    await this.eventStore.append(workspacePath, {
      type: "orchestration_step",
      profileId: fromProfileId,
      status: "paused",
      message: command.reason,
      metadata: { planId: plan.id, agenthubCommand: command },
    });
  }

  private findOnlineSession(workspacePath: string, profileId: string): TaskPlanSession | undefined {
    return this.sessions
      .listSessions()
      .find(
        (session) =>
          session.status === "online" &&
          session.profileId === profileId &&
          session.workspacePath === workspacePath,
      );
  }

  private async nextAttempt(workspacePath: string, planId: string, taskId: string): Promise<number> {
    const history = await this.taskPlanStore.listTaskHistory(workspacePath, planId);
    return history.filter((task) => task.id === taskId && task.status === "running").length + 1;
  }

  private async currentAttempt(workspacePath: string, planId: string, taskId: string): Promise<number> {
    const history = await this.taskPlanStore.listTaskHistory(workspacePath, planId);
    const latest = history
      .slice()
      .reverse()
      .find((task) => task.id === taskId);
    return latest?.attempt ?? 1;
  }

  private async hasCompletedSourceEvent(workspacePath: string, planId: string, sourceEventId: string): Promise<boolean> {
    return (await this.taskPlanStore.listEvents(workspacePath, planId)).some(
      (event) => event.type === "hook_completed" && event.sourceEventId === sourceEventId,
    );
  }

  private async rejectUnauthorizedManagerCommand(
    workspacePath: string,
    plan: TaskPlan,
    fromProfileId: string,
    command: ManagerCommand,
    sourceEventId?: string,
  ): Promise<void> {
    const message = `Profile ${fromProfileId} is not the manager for task plan ${plan.id}`;
    await this.taskPlanStore.appendEvent(workspacePath, plan.id, {
      type: "parse_error",
      taskId: "task_id" in command ? command.task_id : undefined,
      fromProfileId,
      message,
      sourceEventId,
    });
    await this.eventStore.append(workspacePath, {
      type: "error",
      profileId: fromProfileId,
      parentEventId: sourceEventId,
      message,
      error: message,
      metadata: { planId: plan.id, agenthubCommand: command },
    });
  }

  private async recordUnmatchedHook(workspacePath: string, plan: TaskPlan, event: AgentHubEvent): Promise<void> {
    const message = "Hook output is missing task/profile/message metadata for this task plan";
    await this.taskPlanStore.appendEvent(workspacePath, plan.id, {
      type: "unmatched_hook",
      taskId: event.taskId,
      fromProfileId: event.profileId,
      message: event.message ?? message,
      runId: event.runId,
      sessionId: event.sessionId,
      sourceEventId: event.id,
    });
    await this.eventStore.append(workspacePath, {
      type: "error",
      profileId: event.profileId,
      parentEventId: event.id,
      message,
      error: message,
      metadata: { planId: plan.id },
    });
  }

  private async writeUniqueArtifact(
    workspacePath: string,
    input: HookCompletionInput,
  ): Promise<{ relativePath: string; absolutePath: string }> {
    const stem = `${safeFileToken(input.taskId)}-${safeFileToken(input.profileId)}${
      input.runId ? `-${safeFileToken(input.runId)}` : ""
    }`;
    for (let index = 1; index < 1000; index += 1) {
      const fileName = index === 1 ? `${stem}.md` : `${stem}-${index}.md`;
      try {
        return await this.taskPlanStore.writeArtifact(workspacePath, input.planId, fileName, input.message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("already exists")) {
          throw error;
        }
      }
    }
    throw new Error("Unable to allocate task plan artifact name");
  }

  private buildManagerPrompt(plan: TaskPlan): string {
    return [
      "AgentHub task-plan manager.",
      `Plan ID: ${plan.id}`,
      `Task source task-plan.md: ${plan.sourcePlanPath}`,
      `Execution snapshot: ${path.join(plan.planPath, "task-plan.md")}`,
      `Available agents: ${plan.participantProfileIds.join(", ")}`,
      "",
      "Use the execution snapshot as the plan for this run. Manage one bounded step at a time. Do not paste long chat history into agent prompts.",
      "Delegate with this exact command shape:",
      '<agenthub>{"action":"assign_task","plan_id":"' +
        plan.id +
        '","task_id":"T001","to":"codex","message":"Implement the bounded task"}</agenthub>',
      "Request review with:",
      '<agenthub>{"action":"request_review","plan_id":"' +
        plan.id +
        '","task_id":"T001","to":"gemini","message":"Review the artifact and risks"}</agenthub>',
      "Approve with:",
      '<agenthub>{"action":"approve_task","plan_id":"' + plan.id + '","task_id":"T001","summary":"Accepted"}</agenthub>',
      "Reject with:",
      '<agenthub>{"action":"reject_task","plan_id":"' +
        plan.id +
        '","task_id":"T001","to":"codex","message":"Required fixes"}</agenthub>',
      "Pause with:",
      '<agenthub>{"action":"pause_plan","plan_id":"' + plan.id + '","reason":"Need user decision"}</agenthub>',
      "Wait for hook observations before assigning the next step.",
    ].join("\r\n");
  }

  private buildTaskPrompt(plan: TaskPlan, fromProfileId: string, command: RoutedCommand): string {
    return [
      "AgentHub task-plan delegated task.",
      `Plan: ${plan.id}`,
      `Task: ${command.task_id}`,
      `From: ${fromProfileId}`,
      "",
      command.message,
      "",
      "When finished, rely on the configured AgentHub hook to return your final result. Keep the result focused on this task.",
    ].join("\r\n");
  }

  private buildReviewPrompt(
    plan: TaskPlan,
    fromProfileId: string,
    command: Extract<AgentHubCommand, { action: "request_review" }>,
  ): string {
    return [
      "AgentHub task-plan review request.",
      `Plan: ${plan.id}`,
      `Task: ${command.task_id}`,
      `From: ${fromProfileId}`,
      "",
      command.message,
      "",
      "Review the referenced task/artifact. When finished, rely on the configured AgentHub hook to return your review.",
    ].join("\r\n");
  }

  private buildHookObservationPrompt(plan: TaskPlan, input: HookCompletionInput, artifactPath: string): string {
    return [
      "AgentHub delegated task completed observation.",
      `Plan ID: ${plan.id}`,
      `Task: ${input.taskId}`,
      `From: ${input.profileId}`,
      `Artifact: ${artifactPath}`,
      "",
      input.message,
      "",
      "Review the artifact. Output approve_task if accepted; output reject_task with required fixes if changes are needed.",
      '<agenthub>{"action":"approve_task","plan_id":"' +
        plan.id +
        '","task_id":"' +
        input.taskId +
        '","summary":"Accepted"}</agenthub>',
      '<agenthub>{"action":"reject_task","plan_id":"' +
        plan.id +
        '","task_id":"' +
        input.taskId +
        '","to":"' +
        input.profileId +
        '","message":"Required fixes"}</agenthub>',
    ].join("\r\n");
  }
}

function isTaskPlanCommand(command: AgentHubCommand): command is ManagerCommand {
  return (
    command.action === "assign_task" ||
    command.action === "approve_task" ||
    command.action === "reject_task" ||
    command.action === "request_review" ||
    command.action === "pause_plan"
  );
}

function safeFileToken(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "value";
}
