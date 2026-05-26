import { contextBridge, ipcRenderer } from "electron";
import {
  IpcChannels,
  type AgentHubEventDto,
  type AgentConversationDto,
  type AgentForwardDto,
  type AgentProfileDto,
  type AgentTaskDto,
  type AppendEventRequest,
  type ClipboardWriteTextRequest,
  type CreateForwardRequest,
  type CreateProfileRequest,
  type CreateTaskRequest,
  type ConversationActionRequest,
  type DuplicateProfileRequest,
  type EventAppendedEvent,
  type ForwardActionRequest,
  type CreateTaskPlanRequest,
  type ReadRunRawLogRequest,
  type RouteInputRequest,
  type RouteInputResponse,
  type RunHistoryDto,
  type SaveClipboardImageRequest,
  type SavedAttachmentDto,
  type SessionErrorEvent,
  type SessionExitEvent,
  type StartOrchestrationRequest,
  type StartManagerConversationRequest,
  type StartPairNegotiationConversationRequest,
  type StartRoundtableConversationRequest,
  type StartProfileRequest,
  type StartPowerShellRequest,
  type StartPowerShellResponse,
  type TaskPlanActionRequest,
  type TaskPlanDto,
  type TaskPlanSourceDto,
  type TerminalAckRequest,
  type TerminalDataEvent,
  type TerminalInputRequest,
  type TerminalResizeRequest,
  type UpdateProfileRequest,
  type UpdateTaskRequest,
  type WorkspaceActivateRequest,
  type WorkspaceDeleteRequest,
  type WorkspaceOpenFolderRequest,
  type WorkspaceDto,
  type WorkspaceLockStatusResponse,
  type WorkspaceRequest,
} from "../shared/ipc";

const agenthub = {
  getDefaultWorkspace(): Promise<string> {
    return ipcRenderer.invoke(IpcChannels.WorkspaceDefault) as Promise<string>;
  },

  listWorkspaces(): Promise<WorkspaceDto[]> {
    return ipcRenderer.invoke(IpcChannels.WorkspacesList) as Promise<WorkspaceDto[]>;
  },

  activateWorkspace(request: WorkspaceActivateRequest): Promise<string> {
    return ipcRenderer.invoke(IpcChannels.WorkspaceActivate, request) as Promise<string>;
  },

  deleteWorkspace(request: WorkspaceDeleteRequest): Promise<WorkspaceDto[]> {
    return ipcRenderer.invoke(IpcChannels.WorkspaceDelete, request) as Promise<WorkspaceDto[]>;
  },

  openWorkspaceFolder(request: WorkspaceOpenFolderRequest): Promise<void> {
    return ipcRenderer.invoke(IpcChannels.WorkspaceOpenFolder, request) as Promise<void>;
  },

  selectWorkspace(request: WorkspaceRequest = {}): Promise<string> {
    return ipcRenderer.invoke(IpcChannels.WorkspaceSelect, request) as Promise<string>;
  },

  startPowerShell(request: StartPowerShellRequest): Promise<StartPowerShellResponse> {
    return ipcRenderer.invoke(IpcChannels.StartPowerShell, request) as Promise<StartPowerShellResponse>;
  },

  listProfiles(): Promise<AgentProfileDto[]> {
    return ipcRenderer.invoke(IpcChannels.ProfilesList) as Promise<AgentProfileDto[]>;
  },

  createProfile(request: CreateProfileRequest): Promise<AgentProfileDto> {
    return ipcRenderer.invoke(IpcChannels.ProfilesCreate, request) as Promise<AgentProfileDto>;
  },

  updateProfile(request: UpdateProfileRequest): Promise<AgentProfileDto> {
    return ipcRenderer.invoke(IpcChannels.ProfilesUpdate, request) as Promise<AgentProfileDto>;
  },

  deleteProfile(id: string): Promise<void> {
    return ipcRenderer.invoke(IpcChannels.ProfilesDelete, id) as Promise<void>;
  },

  duplicateProfile(request: DuplicateProfileRequest): Promise<AgentProfileDto> {
    return ipcRenderer.invoke(IpcChannels.ProfilesDuplicate, request) as Promise<AgentProfileDto>;
  },

  startProfile(request: StartProfileRequest): Promise<StartPowerShellResponse> {
    return ipcRenderer.invoke(IpcChannels.StartProfile, request) as Promise<StartPowerShellResponse>;
  },

  listSessions(): Promise<StartPowerShellResponse[]> {
    return ipcRenderer.invoke(IpcChannels.SessionsList) as Promise<StartPowerShellResponse[]>;
  },

  terminalInput(request: TerminalInputRequest): Promise<void> {
    return ipcRenderer.invoke(IpcChannels.TerminalInput, request) as Promise<void>;
  },

  terminalResize(request: TerminalResizeRequest): Promise<void> {
    return ipcRenderer.invoke(IpcChannels.TerminalResize, request) as Promise<void>;
  },

  terminalAck(request: TerminalAckRequest): Promise<void> {
    return ipcRenderer.invoke(IpcChannels.TerminalAck, request) as Promise<void>;
  },

  readClipboardText(): Promise<string> {
    return ipcRenderer.invoke(IpcChannels.ClipboardReadText) as Promise<string>;
  },

  writeClipboardText(request: ClipboardWriteTextRequest): Promise<void> {
    return ipcRenderer.invoke(IpcChannels.ClipboardWriteText, request) as Promise<void>;
  },

  saveClipboardImage(request: SaveClipboardImageRequest = {}): Promise<SavedAttachmentDto | null> {
    return ipcRenderer.invoke(IpcChannels.AttachmentsSaveClipboardImage, request) as Promise<SavedAttachmentDto | null>;
  },

  stopSession(sessionId: string): Promise<void> {
    return ipcRenderer.invoke(IpcChannels.StopSession, sessionId) as Promise<void>;
  },

  routeInput(request: RouteInputRequest): Promise<RouteInputResponse> {
    return ipcRenderer.invoke(IpcChannels.RouteInput, request) as Promise<RouteInputResponse>;
  },

  listEvents(request: WorkspaceRequest = {}): Promise<AgentHubEventDto[]> {
    return ipcRenderer.invoke(IpcChannels.EventsList, request) as Promise<AgentHubEventDto[]>;
  },

  appendEvent(request: AppendEventRequest): Promise<AgentHubEventDto> {
    return ipcRenderer.invoke(IpcChannels.EventsAppend, request) as Promise<AgentHubEventDto>;
  },

  listRuns(request: WorkspaceRequest = {}): Promise<RunHistoryDto[]> {
    return ipcRenderer.invoke(IpcChannels.RunsList, request) as Promise<RunHistoryDto[]>;
  },

  readRunRawLog(request: ReadRunRawLogRequest): Promise<string> {
    return ipcRenderer.invoke(IpcChannels.RunRawLog, request) as Promise<string>;
  },

  listTasks(request: WorkspaceRequest = {}): Promise<AgentTaskDto[]> {
    return ipcRenderer.invoke(IpcChannels.TasksList, request) as Promise<AgentTaskDto[]>;
  },

  createTask(request: CreateTaskRequest): Promise<AgentTaskDto> {
    return ipcRenderer.invoke(IpcChannels.TasksCreate, request) as Promise<AgentTaskDto>;
  },

  updateTask(request: UpdateTaskRequest): Promise<AgentTaskDto> {
    return ipcRenderer.invoke(IpcChannels.TasksUpdate, request) as Promise<AgentTaskDto>;
  },

  listTaskPlans(request: WorkspaceRequest = {}): Promise<TaskPlanDto[]> {
    return ipcRenderer.invoke(IpcChannels.TaskPlansList, request) as Promise<TaskPlanDto[]>;
  },

  listTaskPlanSources(request: WorkspaceRequest = {}): Promise<TaskPlanSourceDto[]> {
    return ipcRenderer.invoke(IpcChannels.TaskPlanSourcesList, request) as Promise<TaskPlanSourceDto[]>;
  },

  createTaskPlan(request: CreateTaskPlanRequest): Promise<TaskPlanDto> {
    return ipcRenderer.invoke(IpcChannels.TaskPlansCreate, request) as Promise<TaskPlanDto>;
  },

  startTaskPlanManager(request: TaskPlanActionRequest): Promise<TaskPlanDto> {
    return ipcRenderer.invoke(IpcChannels.TaskPlansStartManager, request) as Promise<TaskPlanDto>;
  },

  readTaskPlanMarkdown(request: TaskPlanActionRequest): Promise<string> {
    return ipcRenderer.invoke(IpcChannels.TaskPlansReadMarkdown, request) as Promise<string>;
  },

  openTaskPlanFolder(request: TaskPlanActionRequest): Promise<void> {
    return ipcRenderer.invoke(IpcChannels.TaskPlansOpenFolder, request) as Promise<void>;
  },

  startOrchestration(request: StartOrchestrationRequest): Promise<{ tasks: AgentTaskDto[] }> {
    return ipcRenderer.invoke(IpcChannels.OrchestrationStart, request) as Promise<{ tasks: AgentTaskDto[] }>;
  },

  createForward(request: CreateForwardRequest): Promise<AgentForwardDto> {
    return ipcRenderer.invoke(IpcChannels.ForwardsCreate, request) as Promise<AgentForwardDto>;
  },

  listForwards(request: WorkspaceRequest = {}): Promise<AgentForwardDto[]> {
    return ipcRenderer.invoke(IpcChannels.ForwardsList, request) as Promise<AgentForwardDto[]>;
  },

  pauseForward(request: ForwardActionRequest): Promise<AgentForwardDto> {
    return ipcRenderer.invoke(IpcChannels.ForwardsPause, request) as Promise<AgentForwardDto>;
  },

  stopForward(request: ForwardActionRequest): Promise<AgentForwardDto> {
    return ipcRenderer.invoke(IpcChannels.ForwardsStop, request) as Promise<AgentForwardDto>;
  },

  sendForward(request: ForwardActionRequest): Promise<AgentForwardDto> {
    return ipcRenderer.invoke(IpcChannels.ForwardsSend, request) as Promise<AgentForwardDto>;
  },

  listConversations(request: WorkspaceRequest = {}): Promise<AgentConversationDto[]> {
    return ipcRenderer.invoke(IpcChannels.ConversationsList, request) as Promise<AgentConversationDto[]>;
  },

  startManagerConversation(request: StartManagerConversationRequest): Promise<AgentConversationDto> {
    return ipcRenderer.invoke(IpcChannels.ConversationsStartManager, request) as Promise<AgentConversationDto>;
  },

  startRoundtableConversation(request: StartRoundtableConversationRequest): Promise<AgentConversationDto> {
    return ipcRenderer.invoke(IpcChannels.ConversationsStartRoundtable, request) as Promise<AgentConversationDto>;
  },

  startPairNegotiationConversation(request: StartPairNegotiationConversationRequest): Promise<AgentConversationDto> {
    return ipcRenderer.invoke(IpcChannels.ConversationsStartPairNegotiation, request) as Promise<AgentConversationDto>;
  },

  pauseConversation(request: ConversationActionRequest): Promise<AgentConversationDto> {
    return ipcRenderer.invoke(IpcChannels.ConversationsPause, request) as Promise<AgentConversationDto>;
  },

  resumeConversation(request: ConversationActionRequest): Promise<AgentConversationDto> {
    return ipcRenderer.invoke(IpcChannels.ConversationsResume, request) as Promise<AgentConversationDto>;
  },

  stopConversation(request: ConversationActionRequest): Promise<AgentConversationDto> {
    return ipcRenderer.invoke(IpcChannels.ConversationsStop, request) as Promise<AgentConversationDto>;
  },

  getWorkspaceLockStatus(): Promise<WorkspaceLockStatusResponse> {
    return ipcRenderer.invoke(IpcChannels.WorkspaceLockStatus) as Promise<WorkspaceLockStatusResponse>;
  },

  onTerminalData(callback: (event: TerminalDataEvent) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent) => callback(payload);
    ipcRenderer.on(IpcChannels.TerminalData, listener);
    return () => ipcRenderer.removeListener(IpcChannels.TerminalData, listener);
  },

  onSessionExit(callback: (event: SessionExitEvent) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: SessionExitEvent) => callback(payload);
    ipcRenderer.on(IpcChannels.SessionExit, listener);
    return () => ipcRenderer.removeListener(IpcChannels.SessionExit, listener);
  },

  onSessionError(callback: (event: SessionErrorEvent) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: SessionErrorEvent) => callback(payload);
    ipcRenderer.on(IpcChannels.SessionError, listener);
    return () => ipcRenderer.removeListener(IpcChannels.SessionError, listener);
  },

  onEventAppended(callback: (event: EventAppendedEvent) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: EventAppendedEvent) => callback(payload);
    ipcRenderer.on(IpcChannels.EventAppended, listener);
    return () => ipcRenderer.removeListener(IpcChannels.EventAppended, listener);
  },
};

contextBridge.exposeInMainWorld("agenthub", agenthub);
