/// <reference types="vite/client" />

import type {
  SessionErrorEvent,
  SessionExitEvent,
  StartPowerShellRequest,
  StartPowerShellResponse,
  TerminalDataEvent,
  TerminalInputRequest,
  TerminalResizeRequest,
} from "../../shared/ipc";

declare global {
  interface Window {
    agenthub: {
      getDefaultWorkspace(): Promise<string>;
      startPowerShell(request: StartPowerShellRequest): Promise<StartPowerShellResponse>;
      terminalInput(request: TerminalInputRequest): Promise<void>;
      terminalResize(request: TerminalResizeRequest): Promise<void>;
      stopSession(sessionId: string): Promise<void>;
      onTerminalData(callback: (event: TerminalDataEvent) => void): () => void;
      onSessionExit(callback: (event: SessionExitEvent) => void): () => void;
      onSessionError(callback: (event: SessionErrorEvent) => void): () => void;
    };
  }
}
