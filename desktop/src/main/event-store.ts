import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export type AgentHubEventType =
  | "user_message"
  | "agent_output"
  | "session_started"
  | "session_exited"
  | "task_created"
  | "task_updated"
  | "orchestration_step"
  | "agent_forward"
  | "error";

export type AgentHubEvent = {
  id: string;
  type: AgentHubEventType;
  timestamp: string;
  message?: string;
  targetProfileId?: string | null;
  profileId?: string;
  profileName?: string;
  sessionId?: string;
  runId?: string;
  taskId?: string;
  status?: string;
  exitCode?: number | null;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type AppendEventInput = Omit<AgentHubEvent, "id" | "timestamp"> & {
  id?: string;
  timestamp?: string;
};

export class EventStore {
  async append(workspacePath: string, input: AppendEventInput): Promise<AgentHubEvent> {
    const event: AgentHubEvent = {
      id: input.id ?? randomUUID(),
      timestamp: input.timestamp ?? new Date().toISOString(),
      ...input,
    };
    await mkdir(path.dirname(this.eventPath(workspacePath)), { recursive: true });
    await appendFile(this.eventPath(workspacePath), `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }

  async list(workspacePath: string): Promise<AgentHubEvent[]> {
    try {
      const raw = await readFile(this.eventPath(workspacePath), "utf8");
      return raw
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as AgentHubEvent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private eventPath(workspacePath: string): string {
    return path.join(workspacePath, ".agenthub", "events.jsonl");
  }
}
