export const IpcChannels = {
  WorkspaceDefault: "workspace:getDefault",
  WorkspacesList: "workspaces:list",
  WorkspaceActivate: "workspace:activate",
  WorkspaceDelete: "workspace:delete",
  WorkspaceOpenFolder: "workspace:openFolder",
  WorkspaceSelect: "workspace:select",
  StartPowerShell: "agent:startPowerShell",
  ProfilesList: "profiles:list",
  ProfilesCreate: "profiles:create",
  ProfilesUpdate: "profiles:update",
  ProfilesDelete: "profiles:delete",
  ProfilesDuplicate: "profiles:duplicate",
  StartProfile: "agent:startProfile",
  SessionsList: "sessions:list",
  StopSession: "agent:stop",
  TerminalInput: "terminal:input",
  TerminalResize: "terminal:resize",
  TerminalData: "terminal:data",
  SessionExit: "session:exit",
  SessionError: "session:error",
  RouteInput: "input:route",
  EventsList: "events:list",
  EventsAppend: "events:append",
  EventAppended: "events:appended",
  RunsList: "runs:list",
  RunRawLog: "runs:rawLog",
  TasksList: "tasks:list",
  TasksCreate: "tasks:create",
  TasksUpdate: "tasks:update",
  TaskPlanSourcesList: "task-plan-sources:list",
  TaskPlansList: "task-plans:list",
  TaskPlansCreate: "task-plans:create",
  TaskPlansStartManager: "task-plans:startManager",
  TaskPlansReadMarkdown: "task-plans:readMarkdown",
  TaskPlansOpenFolder: "task-plans:openFolder",
  OrchestrationStart: "orchestration:start",
  ForwardsCreate: "forwards:create",
  ForwardsList: "forwards:list",
  ForwardsPause: "forwards:pause",
  ForwardsStop: "forwards:stop",
  ForwardsSend: "forwards:send",
  ConversationsList: "conversations:list",
  ConversationsStartManager: "conversations:startManager",
  ConversationsStartRoundtable: "conversations:startRoundtable",
  ConversationsStartPairNegotiation: "conversations:startPairNegotiation",
  ConversationsPause: "conversations:pause",
  ConversationsResume: "conversations:resume",
  ConversationsStop: "conversations:stop",
  ClipboardReadText: "clipboard:readText",
  ClipboardWriteText: "clipboard:writeText",
  WorkspaceLockStatus: "workspace-lock:status",
} as const;

export type SessionStatus = "starting" | "online" | "exited" | "error";
export type ProfileKind = "powershell" | "codex" | "claude" | "gemini" | "custom";

export type AgentProfileDto = {
  id: string;
  name: string;
  kind: ProfileKind;
  command: string;
  args: string[];
  aliases: string[];
  rolePrompt: string;
  env: Record<string, string>;
  defaultCwd: string | null;
  useWorkspaceWriteLock: boolean;
};

export type StartPowerShellRequest = {
  workspacePath?: string;
  cols: number;
  rows: number;
};

export type StartPowerShellResponse = {
  sessionId: string;
  runId: string;
  profileId: string;
  profileName: string;
  kind: ProfileKind;
  workspacePath: string;
  status: SessionStatus;
  rawLogPath: string;
  metaPath: string;
};

export type StartProfileRequest = {
  profileId: string;
  workspacePath?: string;
  cols: number;
  rows: number;
};

export type TerminalInputRequest = {
  sessionId: string;
  data: string;
};

export type TerminalResizeRequest = {
  sessionId: string;
  cols: number;
  rows: number;
};

export type ClipboardWriteTextRequest = {
  text: string;
};

export type TerminalDataEvent = {
  sessionId: string;
  data: string;
};

export type SessionExitEvent = {
  sessionId: string;
  exitCode: number | null;
};

export type SessionErrorEvent = {
  sessionId?: string;
  message: string;
};

export type RouteInputRequest = WorkspaceRequest & {
  text: string;
};

export type RouteInputResponse = {
  targetProfileId: string | null;
  message: string;
};

export type WorkspaceRequest = {
  workspacePath?: string;
};

export type WorkspaceActivateRequest = {
  workspacePath: string;
};

export type WorkspaceDeleteRequest = {
  workspacePath: string;
};

export type WorkspaceOpenFolderRequest = {
  workspacePath: string;
};

export type WorkspaceDto = {
  path: string;
  name: string;
  lastOpenedAt: string;
  isActive: boolean;
};

export type CreateProfileRequest = Omit<AgentProfileDto, "id"> & { id?: string };
export type UpdateProfileRequest = { id: string; patch: Partial<Omit<AgentProfileDto, "id">> };
export type DuplicateProfileRequest = { id: string; overrides?: Partial<Pick<AgentProfileDto, "id" | "name">> };

export type TaskStatus = "pending" | "running" | "review" | "done" | "failed";
export type AgentTaskDto = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  profileId: string | null;
  runId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type CreateTaskRequest = WorkspaceRequest & Omit<AgentTaskDto, "id" | "createdAt" | "updatedAt">;
export type UpdateTaskRequest = WorkspaceRequest & { taskId: string; patch: Partial<Omit<AgentTaskDto, "id" | "createdAt" | "updatedAt">> };

export type TaskPlanStatus = "draft" | "running" | "paused" | "completed" | "failed" | "archived";
export type TaskPlanDto = {
  id: string;
  title: string;
  status: TaskPlanStatus;
  managerProfileId: string;
  participantProfileIds: string[];
  date: string;
  directoryName: string;
  planPath: string;
  sourceTaskDir: string;
  sourcePlanPath: string;
  createdAt: string;
  updatedAt: string;
};
export type TaskPlanSourceDto = {
  directoryName: string;
  title: string;
  taskDir: string;
  sourcePlanPath: string;
};
export type CreateTaskPlanRequest = WorkspaceRequest & {
  title: string;
  sourceTaskDirectoryName: string;
  managerProfileId: string;
  participantProfileIds: string[];
};
export type TaskPlanActionRequest = WorkspaceRequest & {
  planId: string;
};

export type RunHistoryDto = {
  runId: string;
  profileId: string;
  command: string;
  args: string[];
  workspacePath: string;
  status: "running" | "exited";
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  runPath: string;
  rawLogPath: string;
  metaPath: string;
};
export type ReadRunRawLogRequest = WorkspaceRequest & { runId: string };

export type AgentHubEventDeliveryStatus = "pending" | "sent" | "observed" | "failed";

export type AgentHubEventDto = {
  id: string;
  type:
    | "user_message"
    | "agent_output"
    | "session_started"
    | "session_exited"
    | "task_created"
    | "task_updated"
    | "orchestration_step"
    | "agent_forward"
    | "error";
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

export type AppendEventRequest = WorkspaceRequest & Omit<AgentHubEventDto, "id" | "timestamp">;

export type EventAppendedEvent = {
  workspacePath: string;
  event: AgentHubEventDto;
};

const AGENT_HUB_EVENT_TYPES = new Set<AgentHubEventDto["type"]>([
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

export type StartOrchestrationRequest = WorkspaceRequest & {
  goal: string;
  plannerProfileId?: string;
  implementerProfileId?: string;
  reviewerProfileId?: string;
};

export type ForwardStatus = "pending" | "sent" | "paused" | "stopped" | "blocked";
export type AgentForwardDto = {
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
export type CreateForwardRequest = WorkspaceRequest & {
  sourceProfileId?: string | null;
  targetProfileId: string;
  message: string;
};
export type ForwardActionRequest = WorkspaceRequest & {
  forwardId: string;
};

export type WorkspaceLockStatusResponse = {
  ok: boolean;
  reason?: string;
};

export type ConversationMode = "manager" | "roundtable" | "pair_negotiation";
export type ConversationStatus = "running" | "paused" | "completed" | "failed" | "stopped";
export type AgentConversationDto = {
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

export type StartManagerConversationRequest = WorkspaceRequest & {
  topic: string;
  supervisorProfileId?: string;
  participantProfileIds: string[];
  maxSteps?: number | null;
};

export type StartRoundtableConversationRequest = WorkspaceRequest & {
  topic: string;
  participantProfileIds: string[];
  maxRounds?: number;
};

export type StartPairNegotiationConversationRequest = WorkspaceRequest & {
  topic: string;
  participantProfileIds: string[];
  maxRounds?: number;
};

export type ConversationActionRequest = WorkspaceRequest & {
  conversationId: string;
};

export function isTerminalDataEvent(value: unknown): value is TerminalDataEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.sessionId === "string" && typeof candidate.data === "string";
}

export function isSessionExitEvent(value: unknown): value is SessionExitEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sessionId === "string" &&
    ((typeof candidate.exitCode === "number" && Number.isFinite(candidate.exitCode)) || candidate.exitCode === null)
  );
}

export function isSessionErrorEvent(value: unknown): value is SessionErrorEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    (typeof candidate.sessionId === "string" || candidate.sessionId === undefined) &&
    typeof candidate.message === "string"
  );
}

export function isEventAppendedEvent(value: unknown): value is EventAppendedEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const event = candidate.event as Record<string, unknown> | undefined;
  return (
    typeof candidate.workspacePath === "string" &&
    typeof event === "object" &&
    event !== null &&
    typeof event.id === "string" &&
    typeof event.type === "string" &&
    AGENT_HUB_EVENT_TYPES.has(event.type as AgentHubEventDto["type"]) &&
    typeof event.timestamp === "string" &&
    isOptionalString(event.message) &&
    isOptionalString(event.conversationId) &&
    isOptionalStringOrNull(event.targetProfileId) &&
    isOptionalString(event.profileId) &&
    isOptionalString(event.profileName) &&
    isOptionalString(event.sessionId) &&
    isOptionalString(event.runId) &&
    isOptionalString(event.taskId) &&
    isOptionalString(event.parentEventId) &&
    isOptionalStringArray(event.targetProfileIds) &&
    isOptionalDeliveryStatus(event.deliveryStatus) &&
    isOptionalString(event.status) &&
    isOptionalNumberOrNull(event.exitCode) &&
    isOptionalString(event.error) &&
    isOptionalRecord(event.metadata)
  );
}

export function isStartManagerConversationRequest(value: unknown): value is StartManagerConversationRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isOptionalString(candidate.workspacePath) &&
    typeof candidate.topic === "string" &&
    candidate.topic.trim().length > 0 &&
    isOptionalString(candidate.supervisorProfileId) &&
    Array.isArray(candidate.participantProfileIds) &&
    candidate.participantProfileIds.length > 0 &&
    candidate.participantProfileIds.every((profileId) => typeof profileId === "string" && profileId.length > 0) &&
    (candidate.maxSteps === undefined ||
      candidate.maxSteps === null ||
      (typeof candidate.maxSteps === "number" && Number.isFinite(candidate.maxSteps) && candidate.maxSteps > 0))
  );
}

export function isStartRoundtableConversationRequest(value: unknown): value is StartRoundtableConversationRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isOptionalString(candidate.workspacePath) &&
    typeof candidate.topic === "string" &&
    candidate.topic.trim().length > 0 &&
    Array.isArray(candidate.participantProfileIds) &&
    candidate.participantProfileIds.length > 0 &&
    candidate.participantProfileIds.every((profileId) => typeof profileId === "string" && profileId.length > 0) &&
    (candidate.maxRounds === undefined ||
      (typeof candidate.maxRounds === "number" && Number.isFinite(candidate.maxRounds) && candidate.maxRounds > 0))
  );
}

export function isStartPairNegotiationConversationRequest(
  value: unknown,
): value is StartPairNegotiationConversationRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isOptionalString(candidate.workspacePath) &&
    typeof candidate.topic === "string" &&
    candidate.topic.trim().length > 0 &&
    Array.isArray(candidate.participantProfileIds) &&
    candidate.participantProfileIds.length === 2 &&
    candidate.participantProfileIds.every((profileId) => typeof profileId === "string" && profileId.length > 0) &&
    (candidate.maxRounds === undefined ||
      (typeof candidate.maxRounds === "number" && Number.isFinite(candidate.maxRounds) && candidate.maxRounds > 0))
  );
}

export function isConversationActionRequest(value: unknown): value is ConversationActionRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isOptionalString(candidate.workspacePath) &&
    typeof candidate.conversationId === "string" &&
    candidate.conversationId.trim().length > 0
  );
}

export function isWorkspaceRequest(value: unknown): value is WorkspaceRequest {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return isOptionalString(candidate.workspacePath);
}

export function isCreateTaskPlanRequest(value: unknown): value is CreateTaskPlanRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isOptionalString(candidate.workspacePath) &&
    isNonEmptyString(candidate.title) &&
    isNonEmptyString(candidate.sourceTaskDirectoryName) &&
    isNonEmptyString(candidate.managerProfileId) &&
    Array.isArray(candidate.participantProfileIds) &&
    candidate.participantProfileIds.length > 0 &&
    candidate.participantProfileIds.every(isNonEmptyString)
  );
}

export function isTaskPlanActionRequest(value: unknown): value is TaskPlanActionRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return isOptionalString(candidate.workspacePath) && isNonEmptyString(candidate.planId);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
