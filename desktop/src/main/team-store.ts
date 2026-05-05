import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type AgentTeam = {
  id: string;
  name: string;
  memberProfileIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type EnsureTeamInput = {
  id: string;
  name: string;
  memberProfileIds: string[];
};

export type TeamMailboxAction = "send_message" | "claim_task" | "complete_task";
export type TeamMailboxStatus = "pending" | "sent" | "observed" | "failed";

export type TeamMailboxMessage = {
  id: string;
  teamId: string;
  action: TeamMailboxAction;
  fromProfileId: string;
  toProfileId: string | null;
  message: string;
  taskId: string | null;
  conversationId: string | null;
  status: TeamMailboxStatus;
  sessionId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AppendMailboxInput = {
  teamId: string;
  action: TeamMailboxAction;
  fromProfileId: string;
  toProfileId?: string | null;
  message?: string;
  taskId?: string | null;
  conversationId?: string | null;
  status?: TeamMailboxStatus;
  sessionId?: string | null;
  error?: string | null;
};

export class TeamStore {
  async ensureTeam(workspacePath: string, input: EnsureTeamInput): Promise<AgentTeam> {
    const existing = await this.getTeam(workspacePath, input.id);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const team: AgentTeam = {
      id: input.id,
      name: input.name,
      memberProfileIds: input.memberProfileIds,
      createdAt: now,
      updatedAt: now,
    };
    await mkdir(this.teamPath(workspacePath, team.id), { recursive: true });
    await writeFile(this.teamConfigPath(workspacePath, team.id), `${JSON.stringify(team, null, 2)}\n`, "utf8");
    return team;
  }

  async getTeam(workspacePath: string, teamId: string): Promise<AgentTeam | null> {
    try {
      return parseTeam(JSON.parse(await readFile(this.teamConfigPath(workspacePath, teamId), "utf8")) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async appendMailbox(workspacePath: string, input: AppendMailboxInput): Promise<TeamMailboxMessage> {
    await this.ensureTeam(workspacePath, {
      id: input.teamId,
      name: input.teamId === "default" ? "Default Team" : input.teamId,
      memberProfileIds: [],
    });
    const now = new Date().toISOString();
    const message: TeamMailboxMessage = {
      id: randomUUID(),
      teamId: input.teamId,
      action: input.action,
      fromProfileId: input.fromProfileId,
      toProfileId: input.toProfileId ?? null,
      message: input.message ?? "",
      taskId: input.taskId ?? null,
      conversationId: input.conversationId ?? null,
      status: input.status ?? "pending",
      sessionId: input.sessionId ?? null,
      error: input.error ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await mkdir(path.dirname(this.mailboxPath(workspacePath, input.teamId)), { recursive: true });
    await appendFile(this.mailboxPath(workspacePath, input.teamId), `${JSON.stringify(message)}\n`, "utf8");
    return message;
  }

  async listMailbox(workspacePath: string, teamId: string): Promise<TeamMailboxMessage[]> {
    try {
      const raw = await readFile(this.mailboxPath(workspacePath, teamId), "utf8");
      return raw
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .flatMap((line) => {
          try {
            const message = parseMailboxMessage(JSON.parse(line) as unknown);
            return message ? [message] : [];
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

  private teamPath(workspacePath: string, teamId: string): string {
    return path.join(workspacePath, ".agenthub", "teams", sanitizeTeamId(teamId));
  }

  private teamConfigPath(workspacePath: string, teamId: string): string {
    return path.join(this.teamPath(workspacePath, teamId), "config.json");
  }

  private mailboxPath(workspacePath: string, teamId: string): string {
    return path.join(this.teamPath(workspacePath, teamId), "mailbox.jsonl");
  }
}

function sanitizeTeamId(teamId: string): string {
  return teamId.replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
}

function parseTeam(value: unknown): AgentTeam | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    !Array.isArray(candidate.memberProfileIds) ||
    !candidate.memberProfileIds.every((member) => typeof member === "string") ||
    typeof candidate.createdAt !== "string" ||
    Number.isNaN(Date.parse(candidate.createdAt)) ||
    typeof candidate.updatedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.updatedAt))
  ) {
    return null;
  }
  return candidate as AgentTeam;
}

function parseMailboxMessage(value: unknown): TeamMailboxMessage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.teamId !== "string" ||
    !isMailboxAction(candidate.action) ||
    typeof candidate.fromProfileId !== "string" ||
    !isOptionalStringOrNull(candidate.toProfileId) ||
    typeof candidate.message !== "string" ||
    !isOptionalStringOrNull(candidate.taskId) ||
    !isOptionalStringOrNull(candidate.conversationId) ||
    !isMailboxStatus(candidate.status) ||
    !isOptionalStringOrNull(candidate.sessionId) ||
    !isOptionalStringOrNull(candidate.error) ||
    typeof candidate.createdAt !== "string" ||
    Number.isNaN(Date.parse(candidate.createdAt)) ||
    typeof candidate.updatedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.updatedAt))
  ) {
    return null;
  }
  return candidate as TeamMailboxMessage;
}

function isMailboxAction(value: unknown): value is TeamMailboxAction {
  return value === "send_message" || value === "claim_task" || value === "complete_task";
}

function isMailboxStatus(value: unknown): value is TeamMailboxStatus {
  return value === "pending" || value === "sent" || value === "observed" || value === "failed";
}

function isOptionalStringOrNull(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}
