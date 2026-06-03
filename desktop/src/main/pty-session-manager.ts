import { EventEmitter } from "node:events";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import * as nodePty from "node-pty";
import { RunLogStore } from "./log-store";
import { EventStore } from "./event-store";
import { getDefaultProfiles, type AgentProfile, type AgentProfileKind } from "./profile-store";
import type { ProjectHookInstaller } from "./project-hook-installer";
import { WorkspaceWriteLockService } from "./workspace-write-lock";
import { shouldBufferTerminalInput, type TerminalInputSource } from "./terminal-input-readiness";
import { countUtf8Bytes, subtractAckedBytes } from "./terminal-output-ack";

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
  inputReady: boolean;
  inputBuffer: string[];
  inputReadyTimeout: ReturnType<typeof setTimeout> | null;
  firstOutputReadyTimer: ReturnType<typeof setTimeout> | null;
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
export const INPUT_READY_FIRST_OUTPUT_DELAY_MS = 120;
export const INPUT_READY_TIMEOUT_MS = 3000;

export class NodePtyFactory implements PtyFactory {
  spawn(command: string, args: string[], options: PtySpawnOptions): PtyLike {
    return nodePty.spawn(command, args, options);
  }
}

export function resolveProfileCommand(command: string, env: NodeJS.ProcessEnv = process.env): string {
  if (path.isAbsolute(command) || command.includes("\\") || command.includes("/")) {
    return command;
  }

  const pathValue = env.PATH ?? env.Path ?? env.path;
  const hasExtension = path.extname(command).length > 0;
  const extensions = process.platform === "win32" && !hasExtension
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];

  for (const directory of commandSearchDirectories(pathValue, env)) {
    if (!directory) {
      continue;
    }
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return command;
}

function commandSearchDirectories(pathValue: string | undefined, env: NodeJS.ProcessEnv): string[] {
  const directories = pathValue ? pathValue.split(path.delimiter) : [];
  const userProfile = env.USERPROFILE ?? env.HOME;
  if (userProfile) {
    directories.push(path.join(userProfile, ".local", "bin"));
  }
  if (env.APPDATA) {
    directories.push(path.join(env.APPDATA, "npm"));
  }
  if (env.LOCALAPPDATA) {
    directories.push(path.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps"));
  }
  return [...new Set(directories.filter(Boolean))];
}

function splitSubmittedTerminalInput(data: string): { text: string } | null {
  if (data.length <= 1 || !/[\r\n]$/.test(data)) {
    return null;
  }
  return { text: data.replace(/[\r\n]+$/g, "") };
}

function shouldUseBracketedPaste(kind: AgentProfileKind): boolean {
  return kind === "codex" || kind === "claude" || kind === "gemini";
}

function bracketedPaste(text: string): string {
  return `\x1b[200~${normalizePastedText(text)}\x1b[201~`;
}

function normalizePastedText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function getSubmitDelays(kind: AgentProfileKind, text: string): number[] {
  if (!shouldUseBracketedPaste(kind)) {
    return [25];
  }
  const isMultiline = /[\r\n]/.test(text);
  if (kind === "codex" && isMultiline) {
    return [450, 1400];
  }
  return [450];
}

export function buildProfileLaunchArgs(profile: AgentProfile, options: StartProfileOptions = {}): string[] {
  const args = [...profile.args];
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

export class PtySessionManager extends EventEmitter {
  private readonly ptyFactory: PtyFactory;
  private readonly logStore: RunLogStore;
  private readonly eventStore: EventStore;
  private readonly writeLocks: WorkspaceWriteLockService;
  private readonly hookConfig: AgentHookConfig | undefined;
  private readonly projectHooks: ProjectHookInstaller | undefined;
  private readonly sessions = new Map<string, StoredSession>();

  constructor(options: PtySessionManagerOptions = {}) {
    super();
    this.ptyFactory = options.ptyFactory ?? new NodePtyFactory();
    this.logStore = options.logStore ?? new RunLogStore();
    this.eventStore = options.eventStore ?? new EventStore();
    this.writeLocks = options.writeLocks ?? new WorkspaceWriteLockService();
    this.hookConfig = options.hookConfig;
    this.projectHooks = options.projectHooks;
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
      pty = this.ptyFactory.spawn(resolveProfileCommand(profile.command, env), launchArgs, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: profile.defaultCwd ?? workspacePath,
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
    const session: PtySession = {
      sessionId,
      runId: run.runId,
      profileId: profile.id,
      profileName: profile.name,
      kind: profile.kind,
      pid: pty.pid,
      status: "online",
      workspacePath,
      rawLogPath: run.rawLogPath,
      metaPath: run.metaPath,
    };

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
      inputReady: false,
      inputBuffer: [],
      inputReadyTimeout: null,
      firstOutputReadyTimer: null,
    };
    this.sessions.set(session.sessionId, storedSession);
    storedSession.inputReadyTimeout = setTimeout(() => {
      this.markInputReady(session.sessionId);
    }, INPUT_READY_TIMEOUT_MS);
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

    return session;
  }

  listSessions(): PtySession[] {
    return [...this.sessions.values()].map((stored) => ({ ...stored.session }));
  }

  write(sessionId: string, data: string, source: TerminalInputSource = "program"): void {
    const stored = this.requireSession(sessionId);
    if (source === "user" && !stored.inputReady) {
      this.markInputReady(sessionId);
    }
    if (shouldBufferTerminalInput({ inputReady: stored.inputReady, source })) {
      stored.inputBuffer.push(data);
      return;
    }
    this.writeImmediately(stored, data, source);
  }

  private writeImmediately(stored: StoredSession, data: string, source: TerminalInputSource = "program"): void {
    if (source === "user") {
      stored.pty.write(data);
      return;
    }
    const submittedInput = splitSubmittedTerminalInput(data);
    if (!submittedInput) {
      stored.pty.write(data);
      return;
    }
    stored.pty.write(
      shouldUseBracketedPaste(stored.session.kind) ? bracketedPaste(submittedInput.text) : submittedInput.text,
    );
    for (const delayMs of getSubmitDelays(stored.session.kind, submittedInput.text)) {
      setTimeout(() => {
        if (this.sessions.has(stored.session.sessionId)) {
          stored.pty.write("\r");
        }
      }, delayMs);
    }
  }

  ack(sessionId: string, byteLength: number): number {
    const stored = this.requireSession(sessionId);
    stored.unackedBytes = subtractAckedBytes(stored.unackedBytes, byteLength);
    return stored.unackedBytes;
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.requireSession(sessionId).pty.resize(cols, rows);
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
    try {
      await this.logStore.appendRaw(stored.session.runId, data);
    } catch (error) {
      this.emitPtyError(stored.session.sessionId, error);
      return;
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
    this.scheduleFirstOutputReady(stored);
  }

  private async handleExit(stored: StoredSession, exitCode: number | null): Promise<void> {
    stored.session.status = "exited";
    this.clearInputReadyTimers(stored);
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

  private scheduleFirstOutputReady(stored: StoredSession): void {
    if (stored.inputReady || stored.firstOutputReadyTimer) {
      return;
    }
    const sessionId = stored.session.sessionId;
    stored.firstOutputReadyTimer = setTimeout(() => {
      this.markInputReady(sessionId);
    }, INPUT_READY_FIRST_OUTPUT_DELAY_MS);
  }

  private markInputReady(sessionId: string): void {
    const stored = this.sessions.get(sessionId);
    if (!stored || stored.inputReady) {
      return;
    }
    stored.inputReady = true;
    this.clearInputReadyTimers(stored);
    const buffered = [...stored.inputBuffer];
    stored.inputBuffer = [];
    for (const data of buffered) {
      this.writeImmediately(stored, data);
    }
  }

  private clearInputReadyTimers(stored: StoredSession): void {
    if (stored.inputReadyTimeout) {
      clearTimeout(stored.inputReadyTimeout);
      stored.inputReadyTimeout = null;
    }
    if (stored.firstOutputReadyTimer) {
      clearTimeout(stored.firstOutputReadyTimer);
      stored.firstOutputReadyTimer = null;
    }
  }
}
