import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, type OpenDialogOptions } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  IpcChannels,
  isConversationActionRequest,
  isCreateTaskPlanRequest,
  isSaveClipboardImageRequest,
  isStartManagerConversationRequest,
  isStartPairNegotiationConversationRequest,
  isStartRoundtableConversationRequest,
  isTerminalAckRequest,
  isTaskPlanActionRequest,
  isWorkspaceRequest,
  type AppendEventRequest,
  type ClipboardWriteTextRequest,
  type ConversationActionRequest,
  type CreateForwardRequest,
  type CreateProfileRequest,
  type CreateTaskRequest,
  type CreateTaskPlanRequest,
  type DuplicateProfileRequest,
  type ForwardActionRequest,
  type ReadRunRawLogRequest,
  type RouteInputRequest,
  type SaveClipboardImageRequest,
  type StartManagerConversationRequest,
  type StartOrchestrationRequest,
  type StartPairNegotiationConversationRequest,
  type StartProfileRequest,
  type StartPowerShellRequest,
  type StartRoundtableConversationRequest,
  type TaskPlanActionRequest,
  type TerminalInputRequest,
  type UpdateProfileRequest,
  type UpdateTaskRequest,
  type WorkspaceActivateRequest,
  type WorkspaceDeleteRequest,
  type WorkspaceOpenFolderRequest,
  type WorkspaceRequest,
} from "../shared/ipc";
import { AttachmentStore } from "./attachment-store";
import { EventStore } from "./event-store";
import { hideDefaultApplicationMenu } from "./application-menu";
import { ConversationOrchestrator } from "./conversation-orchestrator";
import { ConversationStore } from "./conversation-store";
import { ForwardService } from "./forward-service";
import { ForwardStore } from "./forward-store";
import { AgentResultHookReceiver } from "./hook-receiver";
import { RunLogStore } from "./log-store";
import { OrchestrationService } from "./orchestration";
import { ProfileStore } from "./profile-store";
import { ProjectAgentHookInstaller } from "./project-hook-installer";
import {
  PtySessionManager,
  type PtySession,
  type PtyDataEvent,
  type PtyErrorEvent,
  type PtyExitEvent,
} from "./pty-session-manager";
import { parseRoutedInput } from "./routing";
import { RunHistoryStore } from "./run-history";
import { observeHookEvent, TaskPlanService } from "./task-plan-service";
import { TaskPlanStore } from "./task-plan-store";
import { TaskStore } from "./task-store";
import { TeamCommandService } from "./team-command-service";
import { TeamStore } from "./team-store";
import { WorkspaceWriteLockService } from "./workspace-write-lock";
import { shouldDisableElectronSandbox } from "./electron-sandbox";
import { getAllowedDevRendererUrl } from "./renderer-url";
import { selectWorkspacePath } from "./workspace-dialog";
import { getDefaultWorkspacePath, resolveWorkspacePath } from "./workspace-path";
import { WorkspaceStore } from "./workspace-store";
import { openWorkspaceFolderPath } from "./workspace-folder";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const eventStore = new EventStore({
  onAppend: (workspacePath, event) => sendToRenderer(IpcChannels.EventAppended, { workspacePath, event }),
});
const conversationStore = new ConversationStore();
const taskStore = new TaskStore();
const taskPlanStore = new TaskPlanStore();
const teamStore = new TeamStore();
const attachmentStore = new AttachmentStore();
const runHistoryStore = new RunHistoryStore();
const writeLocks = new WorkspaceWriteLockService();
let conversationOrchestrator: ConversationOrchestrator | null = null;
let teamCommandService: TeamCommandService | null = null;
let taskPlanService: TaskPlanService | null = null;
const hookReceiver = new AgentResultHookReceiver({
  eventStore,
  onEventAppended: (workspacePath, event) => {
    void observeHookEvent(workspacePath, event, [
      ["task-plan", () => taskPlanService?.handleAgentOutput(workspacePath, event)],
      ["team", () => teamCommandService?.handleAgentOutput(workspacePath, event)],
      ["conversation", () => conversationOrchestrator?.handleAgentOutput(workspacePath, event)],
    ]);
  },
});
const manager = new PtySessionManager({
  logStore: new RunLogStore(),
  eventStore,
  writeLocks,
  hookConfig: hookReceiver.getClientEnvironment(),
  projectHooks: new ProjectAgentHookInstaller(),
});
const forwardService = new ForwardService(new ForwardStore(), eventStore, manager);
const orchestration = new OrchestrationService(taskStore, eventStore, manager);
taskPlanService = new TaskPlanService(taskPlanStore, eventStore, manager);
conversationOrchestrator = new ConversationOrchestrator(conversationStore, eventStore, manager);
teamCommandService = new TeamCommandService(teamStore, taskStore, eventStore, manager);
let activeWorkspacePath = getDefaultWorkspacePath(process.cwd(), process.env.AGENTHUB_WORKSPACE);
let workspaceStore: WorkspaceStore | null = null;

let mainWindow: BrowserWindow | null = null;

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("in-process-gpu");
const disableElectronSandbox = shouldDisableElectronSandbox({
  isPackaged: app.isPackaged,
  nodeEnv: process.env.NODE_ENV,
  noSandbox: process.env.NO_SANDBOX,
});

if (disableElectronSandbox) {
  // Source runs from Windows UNC/mapped drives can fail to launch Chromium child processes with the sandbox enabled.
  app.commandLine.appendSwitch("no-sandbox");
}
app.disableHardwareAcceleration();
hideDefaultApplicationMenu((menu) => Menu.setApplicationMenu(menu));

function createWindow(): BrowserWindow {
  const jsPreloadPath = path.join(__dirname, "../preload/index.js");
  const preloadPath = existsSync(jsPreloadPath) ? jsPreloadPath : path.join(__dirname, "../preload/index.mjs");

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#101214",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !disableElectronSandbox,
      preload: preloadPath,
    },
  });

  if (process.env.NODE_ENV === "development") {
    window.webContents.on("console-message", (details) => {
      console.log(`[renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`);
    });
    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
      console.error(`[renderer:load-failed] ${errorCode} ${errorDescription} ${validatedUrl}`);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      console.error(`[renderer:gone] ${details.reason} exitCode=${details.exitCode}`);
    });
  }

  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  const rendererUrl = getAllowedDevRendererUrl(process.env.ELECTRON_RENDERER_URL, {
    isPackaged: app.isPackaged,
    nodeEnv: process.env.NODE_ENV,
  });
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return window;
}

function sendToRenderer(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

function getProfileStore(): ProfileStore {
  return new ProfileStore({ configPath: path.join(app.getPath("userData"), "profiles.json") });
}

function getWorkspaceStore(): WorkspaceStore {
  workspaceStore ??= new WorkspaceStore({ configPath: path.join(app.getPath("userData"), "workspaces.json") });
  return workspaceStore;
}

async function initializeWorkspaces(): Promise<void> {
  const state = await getWorkspaceStore().initialize(activeWorkspacePath);
  activeWorkspacePath = state.activeWorkspacePath;
}

function resolveRequestWorkspace(workspacePath?: string): string {
  return resolveWorkspacePath(workspacePath, activeWorkspacePath);
}

function resolveAttachmentWorkspace(request: SaveClipboardImageRequest): string {
  if (request.sessionId) {
    const session = manager.listSessions().find((candidate) => candidate.sessionId === request.sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${request.sessionId}`);
    }
    return session.workspacePath;
  }
  return resolveRequestWorkspace(request.workspacePath);
}

function toSessionResponse(session: PtySession): {
  sessionId: string;
  runId: string;
  profileId: string;
  profileName: string;
  kind: PtySession["kind"];
  workspacePath: string;
  status: PtySession["status"];
  rawLogPath: string;
  metaPath: string;
} {
  return {
    sessionId: session.sessionId,
    runId: session.runId,
    profileId: session.profileId,
    profileName: session.profileName,
    kind: session.kind,
    workspacePath: session.workspacePath,
    status: session.status,
    rawLogPath: session.rawLogPath,
    metaPath: session.metaPath,
  };
}

function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.WorkspaceDefault, async () => {
    await initializeWorkspaces();
    return activeWorkspacePath;
  });

  ipcMain.handle(IpcChannels.WorkspacesList, async () => {
    await initializeWorkspaces();
    return getWorkspaceStore().list(activeWorkspacePath);
  });

  ipcMain.handle(IpcChannels.WorkspaceActivate, async (_event, request: WorkspaceActivateRequest) => {
    const state = await getWorkspaceStore().activate(resolveWorkspacePath(request.workspacePath, activeWorkspacePath));
    activeWorkspacePath = state.activeWorkspacePath;
    return activeWorkspacePath;
  });

  ipcMain.handle(IpcChannels.WorkspaceDelete, async (_event, request: WorkspaceDeleteRequest) => {
    await initializeWorkspaces();
    await getWorkspaceStore().remove(resolveWorkspacePath(request.workspacePath, activeWorkspacePath), activeWorkspacePath);
    return getWorkspaceStore().list(activeWorkspacePath);
  });

  ipcMain.handle(IpcChannels.WorkspaceOpenFolder, async (_event, request: WorkspaceOpenFolderRequest) => {
    await openWorkspaceFolderPath(resolveWorkspacePath(request.workspacePath, activeWorkspacePath), (workspacePath) =>
      shell.openPath(workspacePath),
    );
  });

  ipcMain.handle(IpcChannels.WorkspaceSelect, async (_event, request: WorkspaceRequest = {}) => {
    await initializeWorkspaces();
    const currentWorkspacePath = resolveRequestWorkspace(request.workspacePath);
    const selectedWorkspacePath = await selectWorkspacePath(currentWorkspacePath, async (defaultPath) => {
      const options: OpenDialogOptions = {
        title: "Open Workspace",
        defaultPath,
        properties: ["openDirectory", "createDirectory"],
      };
      return mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options);
    });
    const state = await getWorkspaceStore().activate(selectedWorkspacePath);
    activeWorkspacePath = state.activeWorkspacePath;
    return activeWorkspacePath;
  });

  ipcMain.handle(IpcChannels.StartPowerShell, async (_event, request: StartPowerShellRequest) => {
    const workspacePath = resolveRequestWorkspace(request.workspacePath);
    const session = await manager.startPowerShell({
      workspacePath,
      cols: request.cols,
      rows: request.rows,
    });

    return toSessionResponse(session);
  });

  ipcMain.handle(IpcChannels.ProfilesList, () => getProfileStore().list());

  ipcMain.handle(IpcChannels.ProfilesCreate, (_event, request: CreateProfileRequest) => getProfileStore().create(request));

  ipcMain.handle(IpcChannels.ProfilesUpdate, (_event, request: UpdateProfileRequest) =>
    getProfileStore().update(request.id, request.patch),
  );

  ipcMain.handle(IpcChannels.ProfilesDelete, (_event, id: string) => getProfileStore().delete(id));

  ipcMain.handle(IpcChannels.ProfilesDuplicate, (_event, request: DuplicateProfileRequest) =>
    getProfileStore().duplicate(request.id, request.overrides),
  );

  ipcMain.handle(IpcChannels.StartProfile, async (_event, request: StartProfileRequest) => {
    const profile = await getProfileStore().get(request.profileId);
    if (!profile) {
      throw new Error(`Unknown profile: ${request.profileId}`);
    }
    const session = await manager.startProfile(profile, resolveRequestWorkspace(request.workspacePath), request.cols, request.rows, {
      resumeLast: request.resumeLast,
    });
    return toSessionResponse(session);
  });

  ipcMain.handle(IpcChannels.SessionsList, () => manager.listSessions().map(toSessionResponse));

  ipcMain.handle(IpcChannels.RouteInput, async (_event, request: RouteInputRequest) => {
    const profiles = await getProfileStore().list();
    const routed = parseRoutedInput(request.text, profiles);
    await eventStore.append(resolveRequestWorkspace(request.workspacePath), {
      type: "user_message",
      message: routed.message,
      targetProfileId: routed.targetProfileId,
    });
    return routed;
  });

  ipcMain.handle(IpcChannels.EventsList, (_event, request: WorkspaceRequest = {}) =>
    eventStore.list(resolveRequestWorkspace(request.workspacePath)),
  );

  ipcMain.handle(IpcChannels.EventsAppend, (_event, request: AppendEventRequest) => {
    const { workspacePath, ...event } = request;
    return eventStore.append(resolveRequestWorkspace(workspacePath), event);
  });

  ipcMain.handle(IpcChannels.RunsList, (_event, request: WorkspaceRequest = {}) =>
    runHistoryStore.list(resolveRequestWorkspace(request.workspacePath)),
  );

  ipcMain.handle(IpcChannels.RunRawLog, (_event, request: ReadRunRawLogRequest) =>
    runHistoryStore.readRawLog(resolveRequestWorkspace(request.workspacePath), request.runId),
  );

  ipcMain.handle(IpcChannels.TasksList, (_event, request: WorkspaceRequest = {}) =>
    taskStore.list(resolveRequestWorkspace(request.workspacePath)),
  );

  ipcMain.handle(IpcChannels.TasksCreate, async (_event, request: CreateTaskRequest) => {
    const { workspacePath, ...task } = request;
    const workspace = resolveRequestWorkspace(workspacePath);
    const created = await taskStore.create(workspace, task);
    await eventStore.append(workspace, {
      type: "task_created",
      taskId: created.id,
      profileId: created.profileId ?? undefined,
      status: created.status,
      message: created.title,
    });
    return created;
  });

  ipcMain.handle(IpcChannels.TasksUpdate, async (_event, request: UpdateTaskRequest) => {
    const workspace = resolveRequestWorkspace(request.workspacePath);
    const updated = await taskStore.update(workspace, request.taskId, request.patch);
    await eventStore.append(workspace, {
      type: "task_updated",
      taskId: updated.id,
      profileId: updated.profileId ?? undefined,
      status: updated.status,
      message: updated.title,
    });
    return updated;
  });

  ipcMain.handle(IpcChannels.TaskPlansList, (_event, request: unknown) => {
    if (!isWorkspaceRequest(request)) {
      throw new Error("Invalid workspace request");
    }
    if (!taskPlanService) {
      throw new Error("Task plan service is not available");
    }
    const normalizedRequest = request ?? {};
    return taskPlanService.listPlans(resolveRequestWorkspace(normalizedRequest.workspacePath));
  });

  ipcMain.handle(IpcChannels.TaskPlanSourcesList, (_event, request: unknown) => {
    if (!isWorkspaceRequest(request)) {
      throw new Error("Invalid workspace request");
    }
    const normalizedRequest = request ?? {};
    return taskPlanStore.listSourceTasks(resolveRequestWorkspace(normalizedRequest.workspacePath));
  });

  ipcMain.handle(IpcChannels.TaskPlansCreate, (_event, request: CreateTaskPlanRequest) => {
    if (!isCreateTaskPlanRequest(request)) {
      throw new Error("Invalid task plan create request");
    }
    if (!taskPlanService) {
      throw new Error("Task plan service is not available");
    }
    const { workspacePath, ...input } = request;
    return taskPlanService.createPlan(resolveRequestWorkspace(workspacePath), input);
  });

  ipcMain.handle(IpcChannels.TaskPlansStartManager, (_event, request: TaskPlanActionRequest) => {
    if (!isTaskPlanActionRequest(request)) {
      throw new Error("Invalid task plan action request");
    }
    if (!taskPlanService) {
      throw new Error("Task plan service is not available");
    }
    return taskPlanService.startManager(resolveRequestWorkspace(request.workspacePath), { planId: request.planId });
  });

  ipcMain.handle(IpcChannels.TaskPlansReadMarkdown, (_event, request: TaskPlanActionRequest) => {
    if (!isTaskPlanActionRequest(request)) {
      throw new Error("Invalid task plan action request");
    }
    return taskPlanStore.readMarkdown(resolveRequestWorkspace(request.workspacePath), request.planId);
  });

  ipcMain.handle(IpcChannels.TaskPlansOpenFolder, async (_event, request: TaskPlanActionRequest) => {
    if (!isTaskPlanActionRequest(request)) {
      throw new Error("Invalid task plan action request");
    }
    const plan = await taskPlanStore.getPlan(resolveRequestWorkspace(request.workspacePath), request.planId);
    const error = await shell.openPath(plan.planPath);
    if (error) {
      throw new Error(`Failed to open task plan folder: ${error}`);
    }
  });

  ipcMain.handle(IpcChannels.OrchestrationStart, async (_event, request: StartOrchestrationRequest) => {
    const profiles = await getProfileStore().list();
    const rolePrompts = Object.fromEntries(profiles.map((profile) => [profile.id, profile.rolePrompt]));
    return orchestration.start({
      workspacePath: resolveRequestWorkspace(request.workspacePath),
      goal: request.goal,
      plannerProfileId: request.plannerProfileId,
      implementerProfileId: request.implementerProfileId,
      reviewerProfileId: request.reviewerProfileId,
      rolePrompts,
    });
  });

  ipcMain.handle(IpcChannels.ForwardsCreate, (_event, request: CreateForwardRequest) => {
    const { workspacePath, ...forward } = request;
    return forwardService.create(resolveRequestWorkspace(workspacePath), forward);
  });

  ipcMain.handle(IpcChannels.ForwardsList, (_event, request: WorkspaceRequest = {}) =>
    forwardService.list(resolveRequestWorkspace(request.workspacePath)),
  );

  ipcMain.handle(IpcChannels.ForwardsPause, (_event, request: ForwardActionRequest) =>
    forwardService.pause(resolveRequestWorkspace(request.workspacePath), request.forwardId),
  );

  ipcMain.handle(IpcChannels.ForwardsStop, (_event, request: ForwardActionRequest) =>
    forwardService.stop(resolveRequestWorkspace(request.workspacePath), request.forwardId),
  );

  ipcMain.handle(IpcChannels.ForwardsSend, (_event, request: ForwardActionRequest) =>
    forwardService.send(resolveRequestWorkspace(request.workspacePath), request.forwardId),
  );

  ipcMain.handle(IpcChannels.ClipboardReadText, () => clipboard.readText());

  ipcMain.handle(IpcChannels.ClipboardWriteText, (_event, request: ClipboardWriteTextRequest) => {
    if (typeof request.text !== "string") {
      throw new Error("Invalid clipboard write request");
    }
    clipboard.writeText(request.text);
  });

  ipcMain.handle(IpcChannels.AttachmentsSaveClipboardImage, async (_event, request: unknown = {}) => {
    if (!isSaveClipboardImageRequest(request)) {
      throw new Error("Invalid clipboard image request");
    }
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return null;
    }
    return attachmentStore.saveImage({
      workspacePath: resolveAttachmentWorkspace(request),
      mimeType: "image/png",
      fileName: request.fileName ?? "clipboard-image.png",
      data: image.toPNG(),
    });
  });

  ipcMain.handle(IpcChannels.ConversationsList, (_event, request: WorkspaceRequest = {}) =>
    conversationStore.list(resolveRequestWorkspace(request.workspacePath)),
  );

  ipcMain.handle(IpcChannels.ConversationsStartManager, async (_event, request: StartManagerConversationRequest) => {
    if (!isStartManagerConversationRequest(request)) {
      throw new Error("Invalid manager conversation request");
    }
    if (!conversationOrchestrator) {
      throw new Error("Conversation orchestrator is not available");
    }
    return conversationOrchestrator.startManager({
      workspacePath: resolveRequestWorkspace(request.workspacePath),
      topic: request.topic,
      supervisorProfileId: request.supervisorProfileId,
      participantProfileIds: request.participantProfileIds,
      maxSteps: request.maxSteps,
    });
  });

  ipcMain.handle(IpcChannels.ConversationsStartRoundtable, async (_event, request: StartRoundtableConversationRequest) => {
    if (!isStartRoundtableConversationRequest(request)) {
      throw new Error("Invalid roundtable conversation request");
    }
    if (!conversationOrchestrator) {
      throw new Error("Conversation orchestrator is not available");
    }
    return conversationOrchestrator.startRoundtable({
      workspacePath: resolveRequestWorkspace(request.workspacePath),
      participantProfileIds: request.participantProfileIds,
      topic: request.topic,
      maxRounds: request.maxRounds,
    });
  });

  ipcMain.handle(IpcChannels.ConversationsStartPairNegotiation, async (_event, request: StartPairNegotiationConversationRequest) => {
    if (!isStartPairNegotiationConversationRequest(request)) {
      throw new Error("Invalid pair negotiation conversation request");
    }
    if (!conversationOrchestrator) {
      throw new Error("Conversation orchestrator is not available");
    }
    return conversationOrchestrator.startPairNegotiation({
      workspacePath: resolveRequestWorkspace(request.workspacePath),
      participantProfileIds: request.participantProfileIds,
      topic: request.topic,
      maxRounds: request.maxRounds,
    });
  });

  ipcMain.handle(IpcChannels.ConversationsPause, async (_event, request: ConversationActionRequest) => {
    if (!isConversationActionRequest(request)) {
      throw new Error("Invalid conversation action request");
    }
    const workspacePath = resolveRequestWorkspace(request.workspacePath);
    const conversation = await conversationStore.update(workspacePath, request.conversationId, { status: "paused" });
    await eventStore.append(workspacePath, {
      type: "orchestration_step",
      conversationId: conversation.id,
      status: "paused",
      message: `会话已暂停：${conversation.topic}`,
    });
    return conversation;
  });

  ipcMain.handle(IpcChannels.ConversationsResume, async (_event, request: ConversationActionRequest) => {
    if (!isConversationActionRequest(request)) {
      throw new Error("Invalid conversation action request");
    }
    const workspacePath = resolveRequestWorkspace(request.workspacePath);
    const conversation = await conversationStore.update(workspacePath, request.conversationId, { status: "running" });
    await eventStore.append(workspacePath, {
      type: "orchestration_step",
      conversationId: conversation.id,
      status: "running",
      message: `会话已继续：${conversation.topic}`,
    });
    return conversation;
  });

  ipcMain.handle(IpcChannels.ConversationsStop, async (_event, request: ConversationActionRequest) => {
    if (!isConversationActionRequest(request)) {
      throw new Error("Invalid conversation action request");
    }
    const workspacePath = resolveRequestWorkspace(request.workspacePath);
    const conversation = await conversationStore.update(workspacePath, request.conversationId, { status: "stopped" });
    await eventStore.append(workspacePath, {
      type: "orchestration_step",
      conversationId: conversation.id,
      status: "stopped",
      message: `会话已停止：${conversation.topic}`,
    });
    return conversation;
  });

  ipcMain.handle(IpcChannels.WorkspaceLockStatus, () => {
    const decision = writeLocks.canChangeWorkspace();
    return decision.ok ? { ok: true } : { ok: false, reason: decision.reason };
  });

  ipcMain.handle(IpcChannels.TerminalInput, (_event, request: TerminalInputRequest) => {
    manager.write(request.sessionId, request.data, request.source);
  });

  ipcMain.handle(IpcChannels.TerminalAck, (_event, request: unknown) => {
    if (!isTerminalAckRequest(request)) {
      throw new Error("Invalid terminal ACK request");
    }
    manager.ack(request.sessionId, request.byteLength);
  });

  ipcMain.handle(IpcChannels.TerminalResize, (_event, request: { sessionId: string; cols: number; rows: number }) => {
    manager.resize(request.sessionId, request.cols, request.rows);
  });

  ipcMain.handle(IpcChannels.StopSession, (_event, sessionId: string) => {
    manager.stop(sessionId);
  });
}

manager.on("data", (event: PtyDataEvent) => {
  sendToRenderer(IpcChannels.TerminalData, event);
});

manager.on("exit", (event: PtyExitEvent) => {
  sendToRenderer(IpcChannels.SessionExit, event);
});

manager.on("error", (event: PtyErrorEvent) => {
  sendToRenderer(IpcChannels.SessionError, event);
});

app.whenReady().then(async () => {
  try {
    const hookInfo = await hookReceiver.start();
    console.log(`[agenthub:hook] listening on ${hookInfo.url}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[agenthub:hook] failed to start: ${message}`);
  }
  registerIpcHandlers();
  createWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void hookReceiver.stop();
});
