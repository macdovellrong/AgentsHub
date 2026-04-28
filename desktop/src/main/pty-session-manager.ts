import { EventEmitter } from "node:events";
import process from "node:process";
import { randomUUID } from "node:crypto";
import * as nodePty from "node-pty";
import { RunLogStore } from "./log-store";

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

export type PtySession = {
  sessionId: string;
  runId: string;
  profileId: "powershell";
  pid: number;
  status: "online" | "exited";
  workspacePath: string;
  rawLogPath: string;
};

export type PtyDataEvent = {
  sessionId: string;
  data: string;
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
};

type StoredSession = {
  session: PtySession;
  pty: PtyLike;
  dataSubscription: { dispose: () => void };
  exitSubscription: { dispose: () => void };
  persistenceQueue: Promise<void>;
};

const POWERSHELL_COMMAND = "powershell.exe";
const POWERSHELL_ARGS = [
  "-NoLogo",
  "-NoProfile",
  "-NoExit",
  "-Command",
  "Remove-Module PSReadLine -ErrorAction SilentlyContinue; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; chcp 65001 | Out-Null; Write-Host 'AgentHub PowerShell ready'",
];

export class NodePtyFactory implements PtyFactory {
  spawn(command: string, args: string[], options: PtySpawnOptions): PtyLike {
    return nodePty.spawn(command, args, options);
  }
}

export class PtySessionManager extends EventEmitter {
  private readonly ptyFactory: PtyFactory;
  private readonly logStore: RunLogStore;
  private readonly sessions = new Map<string, StoredSession>();

  constructor(options: PtySessionManagerOptions = {}) {
    super();
    this.ptyFactory = options.ptyFactory ?? new NodePtyFactory();
    this.logStore = options.logStore ?? new RunLogStore();
  }

  async startPowerShell(input: StartPowerShellInput): Promise<PtySession> {
    const run = await this.logStore.createRun({
      workspacePath: input.workspacePath,
      profileId: "powershell",
      command: POWERSHELL_COMMAND,
      args: POWERSHELL_ARGS,
    });
    let pty: PtyLike;
    try {
      pty = this.ptyFactory.spawn(POWERSHELL_COMMAND, POWERSHELL_ARGS, {
        name: "xterm-256color",
        cols: input.cols,
        rows: input.rows,
        cwd: input.workspacePath,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
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
      sessionId: randomUUID(),
      runId: run.runId,
      profileId: "powershell",
      pid: pty.pid,
      status: "online",
      workspacePath: input.workspacePath,
      rawLogPath: run.rawLogPath,
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
    };
    this.sessions.set(session.sessionId, storedSession);

    return session;
  }

  write(sessionId: string, data: string): void {
    this.requireSession(sessionId).pty.write(data);
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
    this.emit("data", { sessionId: stored.session.sessionId, data } satisfies PtyDataEvent);
  }

  private async handleExit(stored: StoredSession, exitCode: number | null): Promise<void> {
    stored.session.status = "exited";
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
      stored.dataSubscription.dispose();
      stored.exitSubscription.dispose();
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
}
