export const IpcChannels = {
  WorkspaceDefault: "workspace:getDefault",
  StartPowerShell: "agent:startPowerShell",
  StopSession: "agent:stop",
  TerminalInput: "terminal:input",
  TerminalResize: "terminal:resize",
  TerminalData: "terminal:data",
  SessionExit: "session:exit",
  SessionError: "session:error",
} as const;

export type SessionStatus = "starting" | "online" | "exited" | "error";

export type StartPowerShellRequest = {
  workspacePath?: string;
  cols: number;
  rows: number;
};

export type StartPowerShellResponse = {
  sessionId: string;
  runId: string;
  workspacePath: string;
  status: SessionStatus;
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
  sessionId: string;
  message: string;
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
