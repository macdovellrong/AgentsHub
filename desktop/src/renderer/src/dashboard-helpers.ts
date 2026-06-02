import type {
  AgentConversationDto,
  AgentHubEventDto,
  AgentProfileDto,
  ConversationMode,
  ConversationStatus,
  CreateProfileRequest,
  StartPowerShellResponse,
} from "../../shared/ipc";
import { UI_TEXT } from "./ui-text";

export type ProfileEditorFields = {
  name: string;
  command: string;
  argsText: string;
  aliasesText: string;
  rolePrompt: string;
  useWorkspaceWriteLock: boolean;
};

export type MentionQuery = {
  start: number;
  end: number;
  query: string;
};

export type QuotedForwardMessage = {
  sender: string;
  message: string;
};

export type ComposerSubmitShortcut = "enter" | "ctrlEnter";

const CONVERSATION_EVENT_TYPES = new Set<AgentHubEventDto["type"]>([
  "user_message",
  "agent_output",
  "task_created",
  "task_updated",
  "orchestration_step",
  "error",
]);

const ACTIVE_CONVERSATION_STATUSES = new Set<ConversationStatus>(["running", "paused"]);
const DEFAULT_TASK_PLAN_SPLIT_RATIO = 0.42;
const MIN_TASK_PLAN_SPLIT_RATIO = 0.24;
const MAX_TASK_PLAN_SPLIT_RATIO = 0.78;

const CONVERSATION_MODE_LABELS: Record<ConversationMode, string> = {
  pair_negotiation: "协商",
  manager: "管理",
  roundtable: "讨论",
};

const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  running: "运行中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
};

const AGENTHUB_COMMAND_PATTERN = /<agenthub>([\s\S]*?)<\/agenthub>/i;

export function splitListInput(value: string): string[] {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isPlainEnterKey(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === "Enter" && !event.shiftKey;
}

export function normalizeComposerSubmitShortcut(value: string | null): ComposerSubmitShortcut {
  return value === "ctrlEnter" ? "ctrlEnter" : "enter";
}

export function isComposerSubmitKey(
  event: { key: string; shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean },
  shortcut: ComposerSubmitShortcut,
): boolean {
  if (event.key !== "Enter" || event.shiftKey) {
    return false;
  }
  if (shortcut === "ctrlEnter") {
    return Boolean(event.ctrlKey || event.metaKey);
  }
  return !event.ctrlKey && !event.metaKey;
}

export function buildComposerDraftStorageKey(workspacePath: string): string {
  const normalized = normalizeWorkspacePath(workspacePath) ?? "default";
  return `agenthub.composerDraft:${normalized}`;
}

export function buildProfileSavePayload(
  profile: AgentProfileDto,
  fields: ProfileEditorFields,
): Omit<CreateProfileRequest, "id"> {
  return {
    kind: profile.kind,
    name: fields.name.trim(),
    command: fields.command.trim(),
    args: splitListInput(fields.argsText),
    aliases: splitListInput(fields.aliasesText),
    rolePrompt: fields.rolePrompt,
    env: { ...profile.env },
    defaultCwd: profile.defaultCwd,
    useWorkspaceWriteLock: fields.useWorkspaceWriteLock,
  };
}

export function profileToFields(profile: AgentProfileDto): ProfileEditorFields {
  return {
    name: profile.name,
    command: profile.command,
    argsText: profile.args.join("\n"),
    aliasesText: profile.aliases.join(" "),
    rolePrompt: profile.rolePrompt,
    useWorkspaceWriteLock: profile.useWorkspaceWriteLock,
  };
}

export function canResumeProfile(profile: AgentProfileDto): boolean {
  return profile.kind === "codex" || profile.kind === "claude" || profile.kind === "gemini";
}

export function clampTaskPlanSplitRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TASK_PLAN_SPLIT_RATIO;
  }
  return Math.min(MAX_TASK_PLAN_SPLIT_RATIO, Math.max(MIN_TASK_PLAN_SPLIT_RATIO, value));
}

export function formatCenterStackRows(input: { taskPlanCollapsed: boolean; taskPlanRatio: number }): string {
  if (input.taskPlanCollapsed) {
    return "minmax(0, 1fr) 8px 42px";
  }
  const taskPlanRatio = clampTaskPlanSplitRatio(input.taskPlanRatio);
  const conversationRatio = Number((1 - taskPlanRatio).toFixed(2));
  return `minmax(260px, ${conversationRatio}fr) 8px minmax(180px, ${taskPlanRatio}fr)`;
}

export function getInputTargetToken(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("@")) {
    return null;
  }
  return trimmed.split(/\s+/, 1)[0].toLowerCase();
}

export function normalizeWorkspacePath(workspacePath: string | undefined): string | null {
  const trimmed = workspacePath?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/[\\/]+$/g, "").replace(/\\/g, "/").toLowerCase();
}

export function isSessionInWorkspace(session: StartPowerShellResponse, workspacePath: string | undefined): boolean {
  const targetWorkspace = normalizeWorkspacePath(workspacePath);
  if (!targetWorkspace) {
    return true;
  }
  return normalizeWorkspacePath(session.workspacePath) === targetWorkspace;
}

export function filterSessionsForWorkspace(
  sessions: StartPowerShellResponse[],
  workspacePath: string | undefined,
): StartPowerShellResponse[] {
  return sessions.filter((session) => session.status === "online" && isSessionInWorkspace(session, workspacePath));
}

export function countOnlineSessionsForWorkspace(
  sessions: StartPowerShellResponse[],
  workspacePath: string | undefined,
): number {
  return filterSessionsForWorkspace(sessions, workspacePath).length;
}

export function findOnlineSessionForProfile(
  profileId: string,
  sessions: StartPowerShellResponse[],
  workspacePath?: string,
): StartPowerShellResponse | null {
  return (
    sessions.find(
      (session) =>
        session.profileId === profileId && session.status === "online" && isSessionInWorkspace(session, workspacePath),
    ) ?? null
  );
}

export function findOnlineSessionForTarget(
  text: string,
  sessions: StartPowerShellResponse[],
  profiles: AgentProfileDto[],
  workspacePath?: string,
): StartPowerShellResponse | null {
  const targetToken = getInputTargetToken(text);

  if (!targetToken) {
    return null;
  }

  const profile = profiles.find((candidate) => {
    const aliases = candidate.aliases.map((alias) => alias.toLowerCase());
    return `@${candidate.id.toLowerCase()}` === targetToken || aliases.includes(targetToken);
  });

  if (!profile) {
    return null;
  }

  return findOnlineSessionForProfile(profile.id, sessions, workspacePath);
}

export function buildRoutedTerminalMessage(profile: AgentProfileDto | undefined, message: string): string {
  void profile;
  return message;
}

export function buildTerminalSubmitInput(profile: AgentProfileDto | undefined, message: string): string {
  const routedMessage = buildRoutedTerminalMessage(profile, message);
  if (routedMessage.endsWith("\r\n")) {
    return routedMessage;
  }
  if (routedMessage.endsWith("\r") || routedMessage.endsWith("\n")) {
    return `${routedMessage.replace(/[\r\n]+$/g, "")}\r\n`;
  }
  return `${routedMessage}\r\n`;
}

export function buildTaskPlanGenerationPrompt(taskDescription: string): string {
  const task = taskDescription.trim();
  return [
    "你是 AgentHub 的任务计划生成器。",
    "",
    "请根据用户需求，在当前工作区创建一个新的任务目录：",
    "",
    "tasks/YYYYMMDD-HHmm-短标题/",
    "",
    "并在该目录下创建：",
    "",
    "task-plan.md",
    "",
    "要求：",
    "1. 目录名使用当前日期时间和简短英文 slug。",
    "2. task-plan.md 必须是可执行的任务计划，不是讨论稿。",
    "3. 任务计划要包含背景、目标、非目标、任务拆解、验收标准、风险点。",
    "4. 每个子任务要有明确编号，例如 T001、T002。",
    "5. 不要修改 .agenthub/ 目录。",
    "6. 不要直接开始实现，先只生成 task-plan.md。",
    "7. 如果需求不清楚，先在聊天中提出需要用户确认的问题。",
    "",
    "用户需求：",
    task,
  ].join("\n");
}

export function pickSelectedSessionId(
  currentSessionId: string | null,
  sessions: StartPowerShellResponse[],
): string | null {
  if (currentSessionId && sessions.some((session) => session.sessionId === currentSessionId)) {
    return currentSessionId;
  }

  return sessions[0]?.sessionId ?? null;
}

export function appendTerminalPreview(current: string, chunk: string, maxLength = 4000): string {
  const withoutAnsi = chunk
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
  const normalized = withoutAnsi.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const combined = `${current}${normalized}`;
  return combined.length > maxLength ? combined.slice(combined.length - maxLength) : combined;
}

export function filterConversationEvents(events: AgentHubEventDto[]): AgentHubEventDto[] {
  return events.filter((event) => CONVERSATION_EVENT_TYPES.has(event.type));
}

function extractAgenthubCommandFromMessage(message: string | undefined): Record<string, unknown> | null {
  if (!message) {
    return null;
  }

  const match = AGENTHUB_COMMAND_PATTERN.exec(message);
  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1] ?? "");
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function describeArtifactCommand(event: AgentHubEventDto, command: Record<string, unknown>): string | null {
  const artifactPath = command.artifact_path;
  if (typeof artifactPath !== "string") {
    return null;
  }

  const summary = command.summary;
  const profileLabel = event.profileName ?? event.profileId ?? "Agent";
  return typeof summary === "string" && summary.length > 0
    ? `${profileLabel} 已写入 ${artifactPath}：${summary}`
    : `${profileLabel} 已写入 ${artifactPath}`;
}

export function describeConversationEvent(event: AgentHubEventDto): string {
  const agenthubCommand = event.metadata?.agenthubCommand;
  if (typeof agenthubCommand === "object" && agenthubCommand !== null) {
    const description = describeArtifactCommand(event, agenthubCommand as Record<string, unknown>);
    if (description) {
      return description;
    }
  }

  const messageCommand = extractAgenthubCommandFromMessage(event.message);
  if (messageCommand) {
    const description = describeArtifactCommand(event, messageCommand);
    if (description) {
      return description;
    }
  }

  if (event.message) {
    return event.message;
  }
  if (event.error) {
    return event.error;
  }
  if (event.type === "session_started") {
    return `${event.profileName ?? event.profileId ?? "Session"} ${UI_TEXT.summaries.started}`;
  }
  if (event.type === "session_exited") {
    return `${event.profileName ?? event.profileId ?? "Session"} ${UI_TEXT.summaries.exited}`;
  }
  return event.type.replace(/_/g, " ");
}

export function formatConversationStatusLabel(status: ConversationStatus): string {
  return CONVERSATION_STATUS_LABELS[status];
}

export function formatConversationModeLabel(mode: ConversationMode): string {
  return CONVERSATION_MODE_LABELS[mode];
}

export function formatParticipantLabel(conversation: Pick<AgentConversationDto, "supervisorProfileId" | "participantProfileIds">): string {
  const participantText = conversation.participantProfileIds.join(", ");
  if (!conversation.supervisorProfileId) {
    return participantText;
  }
  return participantText ? `${conversation.supervisorProfileId} -> ${participantText}` : conversation.supervisorProfileId;
}

export function filterActiveConversations(conversations: AgentConversationDto[]): AgentConversationDto[] {
  return [...conversations]
    .filter((conversation) => ACTIVE_CONVERSATION_STATUSES.has(conversation.status))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function findMentionQuery(text: string, cursor: number): MentionQuery | null {
  const beforeCursor = text.slice(0, cursor);
  const match = /(?:^|\s)@([a-zA-Z0-9_.-]*)$/.exec(beforeCursor);
  if (!match || match.index === undefined) {
    return null;
  }
  const prefixOffset = beforeCursor[match.index] === "@" ? 0 : 1;
  const start = match.index + prefixOffset;
  return {
    start,
    end: cursor,
    query: match[1] ?? "",
  };
}

export function getMentionCandidates(query: string, profiles: AgentProfileDto[]): AgentProfileDto[] {
  const normalizedQuery = query.trim().replace(/^@/, "").toLowerCase();
  return profiles.filter((profile) => {
    const searchValues = [
      profile.id,
      profile.name,
      ...profile.aliases.map((alias) => alias.replace(/^@/, "")),
    ].map((value) => value.toLowerCase());
    return normalizedQuery.length === 0 || searchValues.some((value) => value.includes(normalizedQuery));
  });
}

export function applyMentionSelection(
  text: string,
  mention: MentionQuery,
  profileId: string,
): { text: string; cursor: number } {
  const token = `@${profileId}`;
  const needsTrailingSpace = text[mention.end] !== " ";
  const replacement = needsTrailingSpace ? `${token} ` : token;
  const nextText = `${text.slice(0, mention.start)}${replacement}${text.slice(mention.end)}`;
  return {
    text: nextText,
    cursor: mention.start + replacement.length + (needsTrailingSpace ? 0 : 1),
  };
}

export function buildQuotedForwardMessage(quoted: QuotedForwardMessage, instruction: string): string {
  const trimmedInstruction = instruction.trim();
  const trimmedMessage = quoted.message.trim();
  if (!trimmedInstruction) {
    return trimmedMessage;
  }
  return `${trimmedInstruction}\n\n引用 ${quoted.sender} 的消息：\n${trimmedMessage}`;
}
