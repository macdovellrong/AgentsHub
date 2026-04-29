/// <reference types="vite/client" />

import type {
  AgentHubEventDto,
  AgentForwardDto,
  AgentProfileDto,
  AgentTaskDto,
  AppendEventRequest,
  CreateForwardRequest,
  CreateProfileRequest,
  CreateTaskRequest,
  DuplicateProfileRequest,
  ForwardActionRequest,
  ReadRunRawLogRequest,
  RouteInputRequest,
  RouteInputResponse,
  RunHistoryDto,
  SessionErrorEvent,
  SessionExitEvent,
  StartOrchestrationRequest,
  StartProfileRequest,
  StartPowerShellRequest,
  StartPowerShellResponse,
  TerminalDataEvent,
  TerminalInputRequest,
  TerminalResizeRequest,
  UpdateProfileRequest,
  UpdateTaskRequest,
  WorkspaceLockStatusResponse,
  WorkspaceRequest,
} from "../../shared/ipc";

declare global {
  interface Window {
    agenthub: {
      getDefaultWorkspace(): Promise<string>;
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
      stopSession(sessionId: string): Promise<void>;
      routeInput(request: RouteInputRequest): Promise<RouteInputResponse>;
      listEvents(request?: WorkspaceRequest): Promise<AgentHubEventDto[]>;
      appendEvent(request: AppendEventRequest): Promise<AgentHubEventDto>;
      listRuns(request?: WorkspaceRequest): Promise<RunHistoryDto[]>;
      readRunRawLog(request: ReadRunRawLogRequest): Promise<string>;
      listTasks(request?: WorkspaceRequest): Promise<AgentTaskDto[]>;
      createTask(request: CreateTaskRequest): Promise<AgentTaskDto>;
      updateTask(request: UpdateTaskRequest): Promise<AgentTaskDto>;
      startOrchestration(request: StartOrchestrationRequest): Promise<{ tasks: AgentTaskDto[] }>;
      createForward(request: CreateForwardRequest): Promise<AgentForwardDto>;
      listForwards(request?: WorkspaceRequest): Promise<AgentForwardDto[]>;
      pauseForward(request: ForwardActionRequest): Promise<AgentForwardDto>;
      stopForward(request: ForwardActionRequest): Promise<AgentForwardDto>;
      sendForward(request: ForwardActionRequest): Promise<AgentForwardDto>;
      getWorkspaceLockStatus(): Promise<WorkspaceLockStatusResponse>;
      onTerminalData(callback: (event: TerminalDataEvent) => void): () => void;
      onSessionExit(callback: (event: SessionExitEvent) => void): () => void;
      onSessionError(callback: (event: SessionErrorEvent) => void): () => void;
    };
  }
}
