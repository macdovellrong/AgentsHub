import { EventEmitter } from "node:events";
import process from "node:process";
import { randomUUID } from "node:crypto";
import * as nodePty from "node-pty";
import { RunLogStore } from "./log-store";
import { EventStore } from "./event-store";
import { getDefaultProfiles, type AgentProfile, type AgentProfileKind } from "./profile-store";
import type { ProjectHookInstaller } from "./project-hook-installer";
import { WorkspaceWriteLockService } from "./workspace-write-lock";
import type { TerminalInputSource } from "./terminal-input-readiness";
import { countUtf8Bytes, subtractAckedBytes } from "./terminal-output-ack";
import { buildAgentHostLaunchPlan } from "./agent-host-launcher";
import { AgentTranscriptStore, type AgentTranscriptEvent } from "./agent-transcript-store";
import type { AgentHostLaunchPlan, AgentHostShellKind } from "./agent-host-types";
import { createAgentHostSession, type AgentHostSession } from "./agent-host-session";
import type { RawTerminalStateSnapshot } from "./raw-terminal-state";

export { resolveProfileCommand } from "./agent-host-launcher";
export { INPUT_READY_FIRST_OUTPUT_DELAY_MS, INPUT_READY_TIMEOUT_MS } from "./terminal-input-controller";

export type PtySpawnOptions = {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type PtyLike = {
  pid: number;
  onData(callback: (data: string) => void): { dispose: () => void };
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): { dispose: () => void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};

export type PtyFactory = {
  spawn(command: string, args: string[], options: PtySpawnOptions): PtyLike;
};

export type StartPowerShellInput = {
  workspacePath: string;
  cols: number;
  rows: number;
};

export type StartProfileOptions = {
  resumeLast?: boolean;
  workspacePath?: string;
};

export type PtySession = {
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
  hostKind?: AgentHostShellKind;
  terminalState?: RawTerminalStateSnapshot;
};

export type PtyDataEvent = {
  sessionId: string;
  data: string;
  seq: number;
  byteLength: number;
};

export type PtyExitEvent = {
  sessionId: string;
  exitCode: number | null;
};

export type PtyErrorEvent = {
  sessionId?: string;
  message: string;
};

type PtySessionManagerOptions = {
  ptyFactory?: PtyFactory;
  logStore?: RunLogStore;
  eventStore?: EventStore;
  writeLocks?: WorkspaceWriteLockService;
  hookConfig?: AgentHookConfig;
  projectHooks?: ProjectHookInstaller;
  transcriptStore?: AgentTranscriptStore;
};

export type AgentHookConfig = {
  url: string;
  token: string;
};

type StoredSession = {
  session: PtySession;
  pty: PtyLike;
  dataSubscription: { dispose: () => void };
  exitSubscription: { dispose: () => void };
  persistenceQueue: Promise<void>;
  outputSeq: number;
  unackedBytes: number;
  hostSession: AgentHostSession;
};

const POWERSHELL_COMMAND = "powershell.exe";
const POWERSHELL_ARGS = [
  "-NoLogo",
  "-NoProfile",
  "-NoExit",
  "-Command",
  "Remove-Module PSReadLine -ErrorAction SilentlyContinue; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; chcp 65001 | Out-Null; Write-Host 'AgentHub PowerShell ready'",
];

const RESUMABLE_PROFILE_KINDS = new Set<AgentProfileKind>(["codex", "claude", "gemini"]);
const PROJECT_HOOK_PROFILE_KINDS = new Set<AgentProfileKind>(["codex", "claude", "gemini"]);
const RAW_LOG_DISABLED_PROFILE_KINDS = new Set<AgentProfileKind>(["codex", "claude", "gemini"]);
const CODEX_NO_ALT_SCREEN_ARG = "--no-alt-screen";

export class NodePtyFactory implements PtyFactory {
  spawn(command: string, args: string[], options: PtySpawnOptions): PtyLike {
    return nodePty.spawn(command, args, options);
  }
}

export function buildProfileLaunchArgs(profile: AgentProfile, options: StartProfileOptions = {}): string[] {
  const args = buildBaseProfileArgs(profile);
  if (!options.resumeLast || !RESUMABLE_PROFILE_KINDS.has(profile.kind)) {
    return args;
  }

  if (profile.kind === "codex") {
    if (args.includes("resume")) {
      return args;
    }
    const workspaceArgs =
      options.workspacePath && !args.some((arg) => arg === "--cd" || arg === "-C")
        ? ["--cd", options.workspacePath]
        : [];
    return [...args, "resume", "--last", ...workspaceArgs];
  }
  if (profile.kind === "claude") {
    return args.some((arg) => arg === "--continue" || arg === "-c" || arg === "--resume" || arg === "-r")
      ? args
      : [...args, "--continue"];
  }
  if (profile.kind === "gemini") {
    return args.some((arg) => arg === "--resume" || arg === "-r") ? args : [...args, "--resume", "latest"];
  }
  return args;
}

function buildBaseProfileArgs(profile: AgentProfile): string[] {
  const args = [...profile.args];
  if (profile.kind !== "codex" || args.includes(CODEX_NO_ALT_SCREEN_ARG)) {
    return args;
  }
  return [CODEX_NO_ALT_SCREEN_ARG, ...args];
}

function shouldPersistRawTerminalOutput(kind: AgentProfileKind): boolean {
  return !RAW_LOG_DISABLED_PROFILE_KINDS.has(kind);
}

export class PtySessionManager extends EventEmitter {
  private readonly ptyFactory: PtyFactory;
  private readonly logStore: RunLogStore;
  private readonly eventStore: EventStore;
  private readonly writeLocks: WorkspaceWriteLockService;
  private readonly hookConfig: AgentHookConfig | undefined;
  private readonly projectHooks: ProjectHookInstaller | undefined;
  private readonly transcriptStore: AgentTranscriptStore;
  private readonly sessions = new Map<string, StoredSession>();

  constructor(options: PtySessionManagerOptions = {}) {
    super();
    this.ptyFactory = options.ptyFactory ?? new NodePtyFactory();
    this.logStore = options.logStore ?? new RunLogStore();
    this.eventStore = options.eventStore ?? new EventStore();
    this.writeLocks = options.writeLocks ?? new WorkspaceWriteLockService();
    this.hookConfig = options.hookConfig;
    this.projectHooks = options.projectHooks;
    this.transcriptStore = options.transcriptStore ?? new AgentTranscriptStore();
  }

  async startPowerShell(input: StartPowerShellInput): Promise<PtySession> {
    const powerShellProfile = getDefaultProfiles().find((profile) => profile.id === "powershell");
    if (!powerShellProfile) {
      throw new Error("Default PowerShell profile is unavailable");
    }
    return this.startProfile(powerShellProfile, input.workspacePath, input.cols, input.rows);
  }

  async startProfile(
    profile: AgentProfile,
    workspacePath: string,
    cols: number,
    rows: number,
    options: StartProfileOptions = {},
  ): Promise<PtySession> {
    const lockDecision = this.writeLocks.canStart(workspacePath, profile.useWorkspaceWriteLock);
    if (!lockDecision.ok) {
      throw new Error(lockDecision.reason);
    }
    if (this.projectHooks && PROJECT_HOOK_PROFILE_KINDS.has(profile.kind)) {
      await this.projectHooks.install(workspacePath);
    }
    const launchArgs = buildProfileLaunchArgs(profile, { ...options, workspacePath });
    const run = await this.logStore.createRun({
      workspacePath,
      profileId: profile.id,
      command: profile.command,
      args: launchArgs,
    });
    const sessionId = randomUUID();
    let pty: PtyLike;
    let launchPlan: AgentHostLaunchPlan;
    try {
      const env = {
        ...process.env,
        ...profile.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        ...(this.hookConfig
          ? {
              AGENTHUB_HOOK_URL: this.hookConfig.url,
              AGENTHUB_HOOK_TOKEN: this.hookConfig.token,
              AGENTHUB_PROFILE_ID: profile.id,
              AGENTHUB_SESSION_ID: sessionId,
              AGENTHUB_RUN_ID: run.runId,
              AGENTHUB_WORKSPACE: workspacePath,
              AGENTHUB_TEAM_ID: "default",
            }
          : {}),
      };
      const cwd = profile.defaultCwd ?? workspacePath;
      launchPlan = buildAgentHostLaunchPlan({
        profile,
        launchArgs,
        cwd,
        env,
      });
      pty = this.ptyFactory.spawn(launchPlan.spawn.command, launchPlan.spawn.args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env,
      });
    } catch (error) {
      try {
        await this.logStore.markExited(run.runId, null);
      } catch (markError) {
        this.emitPtyError(undefined, markError);
      }
      throw error;
    }
    const hostSession = createAgentHostSession({
      sessionId,
      runId: run.runId,
      profileId: profile.id,
      profileName: profile.name,
      kind: profile.kind,
      pid: pty.pid,
      workspacePath,
      rawLogPath: run.rawLogPath,
      metaPath: run.metaPath,
      cols,
      rows,
      hostKind: launchPlan.host.kind,
      write: (data) => pty.write(data),
      onInput: (data, currentSession) => {
        void this.appendTranscript(currentSession, {
          type: "terminal_input",
          sessionId: currentSession.sessionId,
          profileId: currentSession.profileId,
          bytes: countUtf8Bytes(data),
        });
      },
    });
    const session: PtySession = this.toPtySession(hostSession);

    let storedSession: StoredSession;
    const dataSubscription = pty.onData((data) => {
      storedSession.persistenceQueue = storedSession.persistenceQueue.then(() => this.persistAndEmitData(storedSession, data));
    });
    const exitSubscription = pty.onExit((event) => {
      void this.handleExit(storedSession, event.exitCode);
    });

    storedSession = {
      session,
      pty,
      dataSubscription,
      exitSubscription,
      persistenceQueue: Promise.resolve(),
      outputSeq: 0,
      unackedBytes: 0,
      hostSession,
    };
    this.sessions.set(session.sessionId, storedSession);
    this.writeLocks.register({
      sessionId: session.sessionId,
      workspacePath,
      profileId: profile.id,
      profileName: profile.name,
      useWorkspaceWriteLock: profile.useWorkspaceWriteLock,
    });
    await this.eventStore.append(workspacePath, {
      type: "session_started",
      sessionId: session.sessionId,
      runId: session.runId,
      profileId: profile.id,
      profileName: profile.name,
    });
    await this.appendTranscript(session, {
      type: "session_started",
      sessionId: session.sessionId,
      profileId: session.profileId,
      hostKind: launchPlan.host.kind,
    });

    return session;
  }

  listSessions(): PtySession[] {
    return [...this.sessions.values()].map((stored) => this.toPtySession(stored.hostSession, stored.session.status));
  }

  write(sessionId: string, data: string, source: TerminalInputSource = "program"): void {
    this.requireSession(sessionId).hostSession.inputController.write(data, source);
  }

  ack(sessionId: string, byteLength: number): number {
    const stored = this.requireSession(sessionId);
    stored.unackedBytes = subtractAckedBytes(stored.unackedBytes, byteLength);
    return stored.unackedBytes;
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const stored = this.requireSession(sessionId);
    stored.hostSession.terminalState.resize(cols, rows);
    stored.pty.resize(cols, rows);
  }

  stop(sessionId: string): void {
    this.requireSession(sessionId).pty.kill();
  }

  private requireSession(sessionId: string): StoredSession {
    const stored = this.sessions.get(sessionId);
    if (!stored) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return stored;
  }

  private async persistAndEmitData(stored: StoredSession, data: string): Promise<void> {
    stored.hostSession.terminalState.recordOutput(data);
    const terminalSnapshot = stored.hostSession.terminalState.snapshot();
    void this.appendTranscript(stored.session, {
      type: "terminal_output",
      sessionId: stored.session.sessionId,
      profileId: stored.session.profileId,
      bytes: countUtf8Bytes(data),
      preview: previewTerminalData(data),
      alternateBuffer: terminalSnapshot.alternateBuffer,
    });
    if (shouldPersistRawTerminalOutput(stored.session.kind)) {
      try {
        await this.logStore.appendRaw(stored.session.runId, data);
      } catch (error) {
        this.emitPtyError(stored.session.sessionId, error);
        return;
      }
    }
    const byteLength = countUtf8Bytes(data);
    stored.outputSeq += 1;
    stored.unackedBytes += byteLength;
    this.emit("data", {
      sessionId: stored.session.sessionId,
      data,
      seq: stored.outputSeq,
      byteLength,
    } satisfies PtyDataEvent);
    stored.hostSession.inputController.handleOutput();
  }

  private async handleExit(stored: StoredSession, exitCode: number | null): Promise<void> {
    stored.session.status = "exited";
    stored.hostSession.session.status = "exited";
    stored.hostSession.inputController.dispose();
    try {
      await stored.persistenceQueue;
    } catch (error) {
      this.emitPtyError(stored.session.sessionId, error);
    }
    try {
      await this.logStore.markExited(stored.session.runId, exitCode);
    } catch (error) {
      this.emitPtyError(stored.session.sessionId, error);
    } finally {
      this.sessions.delete(stored.session.sessionId);
      this.writeLocks.release(stored.session.sessionId);
      stored.dataSubscription.dispose();
      stored.exitSubscription.dispose();
      try {
        await this.eventStore.append(stored.session.workspacePath, {
          type: "session_exited",
          sessionId: stored.session.sessionId,
          runId: stored.session.runId,
          profileId: stored.session.profileId,
          profileName: stored.session.profileName,
          exitCode,
        });
      } catch (error) {
        this.emitPtyError(stored.session.sessionId, error);
      }
      await this.appendTranscript(stored.session, {
        type: "session_exited",
        sessionId: stored.session.sessionId,
        profileId: stored.session.profileId,
        exitCode,
      });
      this.emit("exit", {
        sessionId: stored.session.sessionId,
        exitCode,
      } satisfies PtyExitEvent);
    }
  }

  private emitPtyError(sessionId: string | undefined, error: unknown): void {
    if (this.listenerCount("error") === 0) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    this.emit("error", { sessionId, message } satisfies PtyErrorEvent);
  }

  private async appendTranscript(session: PtySession, event: AgentTranscriptEvent): Promise<void> {
    try {
      await this.transcriptStore.append(session.workspacePath, session.runId, event);
    } catch (error) {
      this.emitPtyError(session.sessionId, error);
    }
  }

  private toPtySession(hostSession: AgentHostSession, status = hostSession.session.status): PtySession {
    return {
      ...hostSession.session,
      status,
      hostKind: hostSession.hostKind,
      terminalState: hostSession.terminalState.snapshot(),
    };
  }
}

function previewTerminalData(data: string): string {
  return data
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .slice(0, 500);
}
