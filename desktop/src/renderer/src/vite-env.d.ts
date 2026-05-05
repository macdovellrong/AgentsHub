/// <reference types="vite/client" />

import type {
  AgentHubEventDto,
  AgentConversationDto,
  AgentForwardDto,
  AgentProfileDto,
  AgentTaskDto,
  AppendEventRequest,
  ClipboardWriteTextRequest,
  CreateForwardRequest,
  CreateProfileRequest,
  CreateTaskRequest,
  CreateTaskPlanRequest,
  ConversationActionRequest,
  DuplicateProfileRequest,
  EventAppendedEvent,
  ForwardActionRequest,
  ReadRunRawLogRequest,
  RouteInputRequest,
  RouteInputResponse,
  RunHistoryDto,
  SessionErrorEvent,
  SessionExitEvent,
  StartOrchestrationRequest,
  StartManagerConversationRequest,
  StartPairNegotiationConversationRequest,
  StartRoundtableConversationRequest,
  StartProfileRequest,
  StartPowerShellRequest,
  StartPowerShellResponse,
  TaskPlanActionRequest,
  TaskPlanDto,
  TaskPlanSourceDto,
  TerminalDataEvent,
  TerminalInputRequest,
  TerminalResizeRequest,
  UpdateProfileRequest,
  UpdateTaskRequest,
  WorkspaceActivateRequest,
  WorkspaceDeleteRequest,
  WorkspaceOpenFolderRequest,
  WorkspaceDto,
  WorkspaceLockStatusResponse,
  WorkspaceRequest,
} from "../../shared/ipc";

declare global {
  interface Window {
    agenthub: {
      getDefaultWorkspace(): Promise<string>;
      listWorkspaces(): Promise<WorkspaceDto[]>;
      activateWorkspace(request: WorkspaceActivateRequest): Promise<string>;
      deleteWorkspace(request: WorkspaceDeleteRequest): Promise<WorkspaceDto[]>;
      openWorkspaceFolder(request: WorkspaceOpenFolderRequest): Promise<void>;
      selectWorkspace(request?: WorkspaceRequest): Promise<string>;
      startPowerShell(request: StartPowerShellRequest): Promise<StartPowerShellResponse>;
      listProfiles(): Promise<AgentProfileDto[]>;
      createProfile(request: CreateProfileRequest): Promise<AgentProfileDto>;
      updateProfile(request: UpdateProfileRequest): Promise<AgentProfileDto>;
      deleteProfile(id: string): Promise<void>;
      duplicateProfile(request: DuplicateProfileRequest): Promise<AgentProfileDto>;
      startProfile(request: StartProfileRequest): Promise<StartPowerShellResponse>;
      listSessions(): Promise<StartPowerShellResponse[]>;
      terminalInput(request: TerminalInputRequest): Promise<void>;
      terminalResize(request: TerminalResizeRequest): Promise<void>;
      readClipboardText(): Promise<string>;
      writeClipboardText(request: ClipboardWriteTextRequest): Promise<void>;
      stopSession(sessionId: string): Promise<void>;
      routeInput(request: RouteInputRequest): Promise<RouteInputResponse>;
      listEvents(request?: WorkspaceRequest): Promise<AgentHubEventDto[]>;
      appendEvent(request: AppendEventRequest): Promise<AgentHubEventDto>;
      listRuns(request?: WorkspaceRequest): Promise<RunHistoryDto[]>;
      readRunRawLog(request: ReadRunRawLogRequest): Promise<string>;
      listTasks(request?: WorkspaceRequest): Promise<AgentTaskDto[]>;
      createTask(request: CreateTaskRequest): Promise<AgentTaskDto>;
      updateTask(request: UpdateTaskRequest): Promise<AgentTaskDto>;
      listTaskPlans(request?: WorkspaceRequest): Promise<TaskPlanDto[]>;
      listTaskPlanSources(request?: WorkspaceRequest): Promise<TaskPlanSourceDto[]>;
      createTaskPlan(request: CreateTaskPlanRequest): Promise<TaskPlanDto>;
      startTaskPlanManager(request: TaskPlanActionRequest): Promise<TaskPlanDto>;
      readTaskPlanMarkdown(request: TaskPlanActionRequest): Promise<string>;
      openTaskPlanFolder(request: TaskPlanActionRequest): Promise<void>;
      startOrchestration(request: StartOrchestrationRequest): Promise<{ tasks: AgentTaskDto[] }>;
      createForward(request: CreateForwardRequest): Promise<AgentForwardDto>;
      listForwards(request?: WorkspaceRequest): Promise<AgentForwardDto[]>;
      pauseForward(request: ForwardActionRequest): Promise<AgentForwardDto>;
      stopForward(request: ForwardActionRequest): Promise<AgentForwardDto>;
      sendForward(request: ForwardActionRequest): Promise<AgentForwardDto>;
      listConversations(request?: WorkspaceRequest): Promise<AgentConversationDto[]>;
      startManagerConversation(request: StartManagerConversationRequest): Promise<AgentConversationDto>;
      startRoundtableConversation(request: StartRoundtableConversationRequest): Promise<AgentConversationDto>;
      startPairNegotiationConversation(request: StartPairNegotiationConversationRequest): Promise<AgentConversationDto>;
      pauseConversation(request: ConversationActionRequest): Promise<AgentConversationDto>;
      resumeConversation(request: ConversationActionRequest): Promise<AgentConversationDto>;
      stopConversation(request: ConversationActionRequest): Promise<AgentConversationDto>;
      getWorkspaceLockStatus(): Promise<WorkspaceLockStatusResponse>;
      onTerminalData(callback: (event: TerminalDataEvent) => void): () => void;
      onSessionExit(callback: (event: SessionExitEvent) => void): () => void;
      onSessionError(callback: (event: SessionErrorEvent) => void): () => void;
      onEventAppended(callback: (event: EventAppendedEvent) => void): () => void;
    };
  }
}
