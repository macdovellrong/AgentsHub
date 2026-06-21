import type { AgentProfileKind } from "./profile-store";
import type { AgentHostShellKind } from "./agent-host-types";
import { createRawTerminalState, type RawTerminalState } from "./raw-terminal-state";
import { createTerminalInputController, type TerminalInputController } from "./terminal-input-controller";

export type AgentHostSessionInfo = {
  sessionId: string;
  runId: string;
  profileId: string;
  profileName: string;
  kind: AgentProfileKind;
  pid: number;
  status: "online" | "exited";
  workspacePath: string;
  rawLogPath: string;
  metaPath: string;
};

export type AgentHostSession = {
  session: AgentHostSessionInfo;
  hostKind: AgentHostShellKind;
  terminalState: RawTerminalState;
  inputController: TerminalInputController;
};

export type CreateAgentHostSessionInput = Omit<AgentHostSessionInfo, "status" | "pid"> & {
  pid?: number;
  cols: number;
  rows: number;
  hostKind: AgentHostShellKind;
  write(data: string): void;
  onInput?: (data: string, session: AgentHostSessionInfo) => void;
};

export function createAgentHostSession(input: CreateAgentHostSessionInput): AgentHostSession {
  const session: AgentHostSessionInfo = {
    sessionId: input.sessionId,
    runId: input.runId,
    profileId: input.profileId,
    profileName: input.profileName,
    kind: input.kind,
    pid: input.pid ?? 0,
    status: "online",
    workspacePath: input.workspacePath,
    rawLogPath: input.rawLogPath,
    metaPath: input.metaPath,
  };
  const terminalState = createRawTerminalState({ cols: input.cols, rows: input.rows });
  const inputController = createTerminalInputController({
    kind: input.kind,
    write: (data) => {
      terminalState.recordInput(data);
      input.onInput?.(data, session);
      input.write(data);
    },
  });

  return {
    session,
    hostKind: input.hostKind,
    terminalState,
    inputController,
  };
}
