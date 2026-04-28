import { contextBridge, ipcRenderer } from "electron";
import {
  IpcChannels,
  type SessionErrorEvent,
  type SessionExitEvent,
  type StartPowerShellRequest,
  type StartPowerShellResponse,
  type TerminalDataEvent,
  type TerminalInputRequest,
  type TerminalResizeRequest,
} from "../shared/ipc";

const agenthub = {
  getDefaultWorkspace(): Promise<string> {
    return ipcRenderer.invoke(IpcChannels.WorkspaceDefault) as Promise<string>;
  },

  startPowerShell(request: StartPowerShellRequest): Promise<StartPowerShellResponse> {
    return ipcRenderer.invoke(IpcChannels.StartPowerShell, request) as Promise<StartPowerShellResponse>;
  },

  terminalInput(request: TerminalInputRequest): Promise<void> {
    return ipcRenderer.invoke(IpcChannels.TerminalInput, request) as Promise<void>;
  },

  terminalResize(request: TerminalResizeRequest): Promise<void> {
    return ipcRenderer.invoke(IpcChannels.TerminalResize, request) as Promise<void>;
  },

  stopSession(sessionId: string): Promise<void> {
    return ipcRenderer.invoke(IpcChannels.StopSession, sessionId) as Promise<void>;
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
};

contextBridge.exposeInMainWorld("agenthub", agenthub);
