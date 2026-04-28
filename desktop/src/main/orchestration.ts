import { EventStore } from "./event-store";
import { TaskStore, type AgentTask } from "./task-store";

export type StartOrchestrationInput = {
  workspacePath: string;
  goal: string;
  plannerProfileId?: string;
  implementerProfileId?: string;
  reviewerProfileId?: string;
};

export type OrchestrationResult = {
  tasks: AgentTask[];
};

export class OrchestrationService {
  constructor(
    private readonly taskStore = new TaskStore(),
    private readonly eventStore = new EventStore(),
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

    for (const task of [planner, implementer, reviewer]) {
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
    }

    return { tasks: [planner, implementer, reviewer] };
  }
}
