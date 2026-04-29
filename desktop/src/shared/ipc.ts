export const IpcChannels = {
  WorkspaceDefault: "workspace:getDefault",
  WorkspacesList: "workspaces:list",
  WorkspaceActivate: "workspace:activate",
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
  RunsList: "runs:list",
  RunRawLog: "runs:rawLog",
  TasksList: "tasks:list",
  TasksCreate: "tasks:create",
  TasksUpdate: "tasks:update",
  OrchestrationStart: "orchestration:start",
  ForwardsCreate: "forwards:create",
  ForwardsList: "forwards:list",
  ForwardsPause: "forwards:pause",
  ForwardsStop: "forwards:stop",
  ForwardsSend: "forwards:send",
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

export type AppendEventRequest = WorkspaceRequest & Omit<AgentHubEventDto, "id" | "timestamp">;

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
    (typeof candidate.exitCode === "number" || candidate.exitCode === null)
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
