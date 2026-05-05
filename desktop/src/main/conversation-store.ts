import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export type ConversationMode = "manager" | "roundtable" | "pair_negotiation";

export type ConversationStatus = "running" | "paused" | "completed" | "failed" | "stopped";

export type AgentConversation = {
  id: string;
  mode: ConversationMode;
  status: ConversationStatus;
  supervisorProfileId: string | null;
  participantProfileIds: string[];
  topic: string;
  currentStep: number;
  maxSteps: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateConversationInput = {
  id?: string;
  mode: ConversationMode;
  supervisorProfileId?: string | null;
  participantProfileIds: string[];
  topic: string;
  status?: ConversationStatus;
  currentStep?: number;
  maxSteps?: number | null;
  createdAt?: string;
  updatedAt?: string;
};

export type UpdateConversationInput = Partial<Omit<AgentConversation, "id" | "createdAt">>;

export class ConversationStore {
  private readonly queues = new Map<string, Promise<unknown>>();

  async create(workspacePath: string, input: CreateConversationInput): Promise<AgentConversation> {
    return this.enqueue(workspacePath, async () => {
      const id = input.id ?? randomUUID();
      if ((await this.list(workspacePath)).some((conversation) => conversation.id === id)) {
        throw new Error(`Conversation already exists: ${id}`);
      }

      const now = new Date().toISOString();
      const conversation: AgentConversation = {
        id,
        mode: input.mode,
        status: input.status ?? "running",
        supervisorProfileId: input.supervisorProfileId ?? null,
        participantProfileIds: input.participantProfileIds,
        topic: input.topic,
        currentStep: input.currentStep ?? 0,
        maxSteps: input.maxSteps ?? null,
        createdAt: input.createdAt ?? now,
        updatedAt: input.updatedAt ?? input.createdAt ?? now,
      };
      assertValidConversation(conversation);
      await this.append(workspacePath, conversation);
      return conversation;
    });
  }

  async update(
    workspacePath: string,
    conversationId: string,
    input: UpdateConversationInput,
  ): Promise<AgentConversation> {
    return this.enqueue(workspacePath, async () => {
      const existing = (await this.list(workspacePath)).find((conversation) => conversation.id === conversationId);
      if (!existing) {
        throw new Error(`Unknown conversation: ${conversationId}`);
      }
      const updated: AgentConversation = {
        ...existing,
        ...input,
        id: conversationId,
        createdAt: existing.createdAt,
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      };
      assertValidConversation(updated);
      await this.append(workspacePath, updated);
      return updated;
    });
  }

  async list(workspacePath: string): Promise<AgentConversation[]> {
    const conversations = new Map<string, AgentConversation>();
    for (const conversation of await this.readAll(workspacePath)) {
      conversations.set(conversation.id, conversation);
    }
    return [...conversations.values()].sort((left, right) => compareIsoDesc(left.updatedAt, right.updatedAt));
  }

  private async readAll(workspacePath: string): Promise<AgentConversation[]> {
    try {
      const raw = await readFile(this.conversationPath(workspacePath), "utf8");
      return raw
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as unknown;
            const conversation = parseConversationRecord(parsed);
            return conversation ? [conversation] : [];
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

  private async append(workspacePath: string, conversation: AgentConversation): Promise<void> {
    await mkdir(path.dirname(this.conversationPath(workspacePath)), { recursive: true });
    await appendFile(this.conversationPath(workspacePath), `${JSON.stringify(conversation)}\n`, "utf8");
  }

  private conversationPath(workspacePath: string): string {
    return path.join(workspacePath, ".agenthub", "conversations", "conversations.jsonl");
  }

  private enqueue<T>(workspacePath: string, operation: () => Promise<T>): Promise<T> {
    const queueKey = normalizeWorkspaceQueueKey(workspacePath);
    const previous = this.queues.get(queueKey) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.queues.set(queueKey, next);
    return next.finally(() => {
      if (this.queues.get(queueKey) === next) {
        this.queues.delete(queueKey);
      }
    });
  }
}

function compareIsoDesc(left: string, right: string): number {
  return Date.parse(right) - Date.parse(left);
}

function normalizeWorkspaceQueueKey(workspacePath: string): string {
  return path.resolve(workspacePath).replace(/[\\/]+$/g, "").toLowerCase();
}

function assertValidConversation(conversation: AgentConversation): void {
  if (!parseConversationRecord(conversation)) {
    throw new Error(`Invalid conversation: ${conversation.id}`);
  }
}

function parseConversationRecord(value: unknown): AgentConversation | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const id = candidate.id;
  const mode = candidate.mode;
  const status = candidate.status;
  const supervisorProfileId = candidate.supervisorProfileId;
  const participantProfileIds = candidate.participantProfileIds;
  const topic = candidate.topic;
  const currentStep = candidate.currentStep;
  const maxSteps = candidate.maxSteps;
  const createdAt = candidate.createdAt;
  const updatedAt = candidate.updatedAt;
  const isValid =
    typeof id === "string" &&
    (mode === "manager" || mode === "roundtable" || mode === "pair_negotiation") &&
    (status === "running" ||
      status === "paused" ||
      status === "completed" ||
      status === "failed" ||
      status === "stopped") &&
    (supervisorProfileId === null || typeof supervisorProfileId === "string") &&
    Array.isArray(participantProfileIds) &&
    participantProfileIds.every((profileId) => typeof profileId === "string") &&
    typeof topic === "string" &&
    typeof currentStep === "number" &&
    Number.isFinite(currentStep) &&
    (maxSteps === undefined || maxSteps === null || (typeof maxSteps === "number" && Number.isFinite(maxSteps))) &&
    typeof createdAt === "string" &&
    !Number.isNaN(Date.parse(createdAt)) &&
    typeof updatedAt === "string" &&
    !Number.isNaN(Date.parse(updatedAt));

  if (!isValid) {
    return null;
  }

  return {
    id,
    mode,
    status,
    supervisorProfileId,
    participantProfileIds,
    topic,
    currentStep,
    maxSteps: maxSteps ?? null,
    createdAt,
    updatedAt,
  };
}
