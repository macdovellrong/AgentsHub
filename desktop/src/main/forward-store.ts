import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export type ForwardStatus = "pending" | "sent" | "paused" | "stopped" | "blocked";

export type AgentForward = {
  id: string;
  sourceProfileId: string | null;
  targetProfileId: string;
  message: string;
  status: ForwardStatus;
  sessionId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};

export type CreateForwardInput = {
  sourceProfileId?: string | null;
  targetProfileId: string;
  message: string;
};

export type UpdateForwardInput = Partial<Omit<AgentForward, "id" | "createdAt">>;

export class ForwardStore {
  async list(workspacePath: string): Promise<AgentForward[]> {
    const forwards = new Map<string, AgentForward>();
    for (const forward of await this.readAll(workspacePath)) {
      forwards.set(forward.id, forward);
    }
    return [...forwards.values()];
  }

  async create(workspacePath: string, input: CreateForwardInput): Promise<AgentForward> {
    const now = new Date().toISOString();
    const forward: AgentForward = {
      id: randomUUID(),
      sourceProfileId: input.sourceProfileId ?? null,
      targetProfileId: input.targetProfileId,
      message: input.message,
      status: "pending",
      sessionId: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      sentAt: null,
    };
    await this.append(workspacePath, forward);
    return forward;
  }

  async update(workspacePath: string, forwardId: string, input: UpdateForwardInput): Promise<AgentForward> {
    const existing = (await this.list(workspacePath)).find((forward) => forward.id === forwardId);
    if (!existing) {
      throw new Error(`Unknown forward: ${forwardId}`);
    }
    const updated: AgentForward = {
      ...existing,
      ...input,
      id: forwardId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.append(workspacePath, updated);
    return updated;
  }

  private async readAll(workspacePath: string): Promise<AgentForward[]> {
    try {
      const raw = await readFile(this.forwardPath(workspacePath), "utf8");
      return raw
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as AgentForward);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async append(workspacePath: string, forward: AgentForward): Promise<void> {
    await mkdir(path.dirname(this.forwardPath(workspacePath)), { recursive: true });
    await appendFile(this.forwardPath(workspacePath), `${JSON.stringify(forward)}\n`, "utf8");
  }

  private forwardPath(workspacePath: string): string {
    return path.join(workspacePath, ".agenthub", "forwards", "forwards.jsonl");
  }
}
