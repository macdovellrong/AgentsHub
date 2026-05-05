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

export type AgentHubEventDeliveryStatus = "pending" | "sent" | "observed" | "failed";

const AGENT_HUB_EVENT_TYPES = new Set<AgentHubEventType>([
  "user_message",
  "agent_output",
  "session_started",
  "session_exited",
  "task_created",
  "task_updated",
  "orchestration_step",
  "agent_forward",
  "error",
]);

export type AgentHubEvent = {
  id: string;
  type: AgentHubEventType;
  timestamp: string;
  message?: string;
  conversationId?: string;
  targetProfileId?: string | null;
  profileId?: string;
  profileName?: string;
  sessionId?: string;
  runId?: string;
  taskId?: string;
  parentEventId?: string;
  targetProfileIds?: string[];
  deliveryStatus?: AgentHubEventDeliveryStatus;
  status?: string;
  exitCode?: number | null;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type AppendEventInput = Omit<AgentHubEvent, "id" | "timestamp"> & {
  id?: string;
  timestamp?: string;
};

export type EventStoreOptions = {
  onAppend?: (workspacePath: string, event: AgentHubEvent) => void;
};

export class EventStore {
  constructor(private readonly options: EventStoreOptions = {}) {}

  async append(workspacePath: string, input: AppendEventInput): Promise<AgentHubEvent> {
    const { id, timestamp, ...eventInput } = input;
    const event: AgentHubEvent = {
      ...eventInput,
      id: id ?? randomUUID(),
      timestamp: timestamp ?? new Date().toISOString(),
    };
    await mkdir(path.dirname(this.eventPath(workspacePath)), { recursive: true });
    await appendFile(this.eventPath(workspacePath), `${JSON.stringify(event)}\n`, "utf8");
    this.options.onAppend?.(workspacePath, event);
    return event;
  }

  async list(workspacePath: string): Promise<AgentHubEvent[]> {
    try {
      const raw = await readFile(this.eventPath(workspacePath), "utf8");
      return raw
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .flatMap((line) => {
          try {
            const event = parseEventRecord(JSON.parse(stripJsonLineBom(line)) as unknown);
            return event ? [event] : [];
          } catch {
            return [];
          }
        });
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

function stripJsonLineBom(line: string): string {
  return line.startsWith("\uFEFF") ? line.slice(1) : line;
}

function parseEventRecord(value: unknown): AgentHubEvent | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const event = value as Record<string, unknown>;
  if (
    typeof event.id !== "string" ||
    typeof event.type !== "string" ||
    !AGENT_HUB_EVENT_TYPES.has(event.type as AgentHubEventType) ||
    typeof event.timestamp !== "string" ||
    Number.isNaN(Date.parse(event.timestamp)) ||
    !isOptionalString(event.message) ||
    !isOptionalString(event.conversationId) ||
    !isOptionalStringOrNull(event.targetProfileId) ||
    !isOptionalString(event.profileId) ||
    !isOptionalString(event.profileName) ||
    !isOptionalString(event.sessionId) ||
    !isOptionalString(event.runId) ||
    !isOptionalString(event.taskId) ||
    !isOptionalString(event.parentEventId) ||
    !isOptionalStringArray(event.targetProfileIds) ||
    !isOptionalDeliveryStatus(event.deliveryStatus) ||
    !isOptionalString(event.status) ||
    !isOptionalNumberOrNull(event.exitCode) ||
    !isOptionalString(event.error) ||
    !isOptionalRecord(event.metadata)
  ) {
    return null;
  }

  return event as AgentHubEvent;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalStringOrNull(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isOptionalStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
}

function isOptionalDeliveryStatus(value: unknown): boolean {
  return value === undefined || value === "pending" || value === "sent" || value === "observed" || value === "failed";
}

function isOptionalNumberOrNull(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalRecord(value: unknown): boolean {
  return value === undefined || (typeof value === "object" && value !== null && !Array.isArray(value));
}
