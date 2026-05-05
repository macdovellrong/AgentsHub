import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type PairConversationArtifactInput = {
  conversationId: string;
  topic: string;
  participantProfileIds: string[];
  maxSteps: number | null;
};

export type PairConversationArtifactPaths = {
  conversationRoot: string;
  briefPath: string;
  memoryPath: string;
  statePath: string;
  turnsPath: string;
};

export type ValidatedArtifactPath = {
  relativePath: string;
  absolutePath: string;
};

export type WriteTurnArtifactInput = {
  conversationId: string;
  step: number;
  profileId: string;
  content: string;
};

export class ConversationArtifactStore {
  async initializePairConversation(
    workspacePath: string,
    input: PairConversationArtifactInput,
  ): Promise<PairConversationArtifactPaths> {
    const conversationId = validateConversationId(input.conversationId);
    const artifactPaths = this.paths(conversationId);
    const safeInput = { ...input, conversationId };

    await mkdir(path.join(workspacePath, artifactPaths.turnsPath), { recursive: true });
    await writeFile(path.join(workspacePath, artifactPaths.briefPath), this.renderBrief(safeInput), "utf8");
    await writeFile(path.join(workspacePath, artifactPaths.memoryPath), this.renderInitialMemory(), "utf8");
    await writeFile(path.join(workspacePath, artifactPaths.statePath), this.renderInitialState(safeInput), "utf8");

    return artifactPaths;
  }

  paths(conversationId: string): PairConversationArtifactPaths {
    const safeConversationId = validateConversationId(conversationId);
    const conversationRoot = `.agenthub/conversations/${safeConversationId}`;
    return {
      conversationRoot,
      briefPath: `${conversationRoot}/brief.md`,
      memoryPath: `${conversationRoot}/memory.md`,
      statePath: `${conversationRoot}/state.json`,
      turnsPath: `${conversationRoot}/turns`,
    };
  }

  turnArtifactPath(conversationId: string, step: number, profileId: string): string {
    const safeConversationId = validateConversationId(conversationId);
    const sequence = String(step).padStart(4, "0");
    const safeProfileId = profileId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
    return `.agenthub/conversations/${safeConversationId}/turns/${sequence}-${safeProfileId}.md`;
  }

  async writeTurnArtifact(workspacePath: string, input: WriteTurnArtifactInput): Promise<ValidatedArtifactPath> {
    const relativePath = this.turnArtifactPath(input.conversationId, input.step, input.profileId);
    const absolutePath = path.join(workspacePath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, ensureTrailingNewline(input.content), "utf8");
    return this.validateTurnArtifactPath(workspacePath, input.conversationId, relativePath);
  }

  async validateTurnArtifactPath(
    workspacePath: string,
    conversationId: string,
    artifactPath: string,
  ): Promise<ValidatedArtifactPath> {
    const safeConversationId = validateConversationId(conversationId);
    const normalized = artifactPath.replace(/\\/g, "/");
    if (path.isAbsolute(normalized) || normalized.split("/").includes("..")) {
      throw new Error("Unsafe artifact path");
    }

    const turnsPrefix = `.agenthub/conversations/${safeConversationId}/turns/`;
    if (!normalized.startsWith(turnsPrefix) || !normalized.endsWith(".md")) {
      throw new Error("Artifact path must stay inside the conversation turns directory");
    }

    const absolutePath = path.resolve(workspacePath, normalized);
    const turnsRoot = path.resolve(workspacePath, ".agenthub", "conversations", safeConversationId, "turns");
    const relativeToTurns = path.relative(turnsRoot, absolutePath);
    if (relativeToTurns.startsWith("..") || path.isAbsolute(relativeToTurns)) {
      throw new Error("Artifact path must stay inside the conversation turns directory");
    }

    try {
      await readFile(absolutePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new Error("Artifact file does not exist");
      }
      throw error;
    }

    return { relativePath: normalized, absolutePath };
  }

  private renderBrief(input: PairConversationArtifactInput): string {
    return [
      "# 协商议题",
      "",
      input.topic,
      "",
      "## 参与者",
      "",
      ...input.participantProfileIds.map((profileId) => `- ${profileId}`),
      "",
      `最大步数: ${input.maxSteps ?? "未限制"}`,
      "",
    ].join("\n");
  }

  private renderInitialMemory(): string {
    return ["# 协商记忆", "", "## 当前共识", "", "## 关键约束", "", "## 未解决问题", "", "## 下一轮关注点", ""].join(
      "\n",
    );
  }

  private renderInitialState(input: PairConversationArtifactInput): string {
    return `${JSON.stringify(
      {
        conversationId: input.conversationId,
        participantProfileIds: input.participantProfileIds,
        maxSteps: input.maxSteps,
        latestProposalVersion: null,
        latestArtifactPath: null,
        status: "running",
      },
      null,
      2,
    )}\n`;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function validateConversationId(conversationId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(conversationId)) {
    throw new Error("Unsafe conversation id");
  }
  return conversationId;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
