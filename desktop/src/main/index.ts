import { app, BrowserWindow, ipcMain } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IpcChannels, type StartPowerShellRequest } from "../shared/ipc";
import { RunLogStore } from "./log-store";
import {
  PtySessionManager,
  type PtyDataEvent,
  type PtyErrorEvent,
  type PtyExitEvent,
} from "./pty-session-manager";
import { getAllowedDevRendererUrl } from "./renderer-url";
import { resolveWorkspacePath } from "./workspace-path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const manager = new PtySessionManager({ logStore: new RunLogStore() });

let mainWindow: BrowserWindow | null = null;

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("in-process-gpu");
// Source runs from Windows UNC/mapped drives can fail to launch Chromium child processes with the sandbox enabled.
app.commandLine.appendSwitch("no-sandbox");
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
      sandbox: false,
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

function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.WorkspaceDefault, () => process.cwd());

  ipcMain.handle(IpcChannels.StartPowerShell, async (_event, request: StartPowerShellRequest) => {
    const workspacePath = resolveWorkspacePath(request.workspacePath, process.cwd());
    const session = await manager.startPowerShell({
      workspacePath,
      cols: request.cols,
      rows: request.rows,
    });

    return {
      sessionId: session.sessionId,
      runId: session.runId,
      workspacePath: session.workspacePath,
      status: session.status,
    };
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
