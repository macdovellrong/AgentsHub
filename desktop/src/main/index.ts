import { app, BrowserWindow, ipcMain } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  IpcChannels,
  type AppendEventRequest,
  type CreateProfileRequest,
  type CreateTaskRequest,
  type DuplicateProfileRequest,
  type ReadRunRawLogRequest,
  type RouteInputRequest,
  type StartOrchestrationRequest,
  type StartProfileRequest,
  type StartPowerShellRequest,
  type UpdateProfileRequest,
  type UpdateTaskRequest,
  type WorkspaceRequest,
} from "../shared/ipc";
import { EventStore } from "./event-store";
import { RunLogStore } from "./log-store";
import { OrchestrationService } from "./orchestration";
import { ProfileStore } from "./profile-store";
import {
  PtySessionManager,
  type PtySession,
  type PtyDataEvent,
  type PtyErrorEvent,
  type PtyExitEvent,
} from "./pty-session-manager";
import { parseRoutedInput } from "./routing";
import { RunHistoryStore } from "./run-history";
import { TaskStore } from "./task-store";
import { WorkspaceWriteLockService } from "./workspace-write-lock";
import { shouldDisableElectronSandbox } from "./electron-sandbox";
import { getAllowedDevRendererUrl } from "./renderer-url";
import { resolveWorkspacePath } from "./workspace-path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const eventStore = new EventStore();
const taskStore = new TaskStore();
const runHistoryStore = new RunHistoryStore();
const writeLocks = new WorkspaceWriteLockService();
const manager = new PtySessionManager({ logStore: new RunLogStore(), eventStore, writeLocks });
const orchestration = new OrchestrationService(taskStore, eventStore);

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

function resolveRequestWorkspace(workspacePath?: string): string {
  return resolveWorkspacePath(workspacePath, process.cwd());
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
  ipcMain.handle(IpcChannels.WorkspaceDefault, () => process.cwd());

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
    const session = await manager.startProfile(profile, resolveRequestWorkspace(request.workspacePath), request.cols, request.rows);
    return toSessionResponse(session);
  });

  ipcMain.handle(IpcChannels.SessionsList, () => manager.listSessions().map(toSessionResponse));

  ipcMain.handle(IpcChannels.RouteInput, async (_event, request: RouteInputRequest) => {
    const profiles = await getProfileStore().list();
    const routed = parseRoutedInput(request.text, profiles);
    await eventStore.append(process.cwd(), {
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

  ipcMain.handle(IpcChannels.OrchestrationStart, (_event, request: StartOrchestrationRequest) =>
    orchestration.start({
      workspacePath: resolveRequestWorkspace(request.workspacePath),
      goal: request.goal,
      plannerProfileId: request.plannerProfileId,
      implementerProfileId: request.implementerProfileId,
      reviewerProfileId: request.reviewerProfileId,
    }),
  );

  ipcMain.handle(IpcChannels.WorkspaceLockStatus, () => {
    const decision = writeLocks.canChangeWorkspace();
    return decision.ok ? { ok: true } : { ok: false, reason: decision.reason };
  });

  ipcMain.handle(IpcChannels.TerminalInput, (_event, request: { sessionId: string; data: string }) => {
    manager.write(request.sessionId, request.data);
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

app.whenReady().then(() => {
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
