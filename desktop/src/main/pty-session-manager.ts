import { EventEmitter } from "node:events";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
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

type PtySessionManagerOptions = {
  ptyFactory?: PtyFactory;
  logStore?: RunLogStore;
};

type StoredSession = {
  session: PtySession;
  pty: PtyLike;
  dataSubscription: { dispose: () => void };
  exitSubscription: { dispose: () => void };
};

const POWERSHELL_COMMAND = "powershell.exe";
const POWERSHELL_ARGS = [
  "-NoLogo",
  "-NoExit",
  "-Command",
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; chcp 65001 | Out-Null; Write-Host 'AgentHub PowerShell ready'",
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
    const pty = this.ptyFactory.spawn(POWERSHELL_COMMAND, POWERSHELL_ARGS, {
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
    const session: PtySession = {
      sessionId: randomUUID(),
      runId: run.runId,
      profileId: "powershell",
      pid: pty.pid,
      status: "online",
      workspacePath: input.workspacePath,
      rawLogPath: run.rawLogPath,
    };

    const dataSubscription = pty.onData((data) => {
      appendFileSync(run.rawLogPath, data, "utf8");
      this.emit("data", { sessionId: session.sessionId, data } satisfies PtyDataEvent);
    });
    const exitSubscription = pty.onExit((event) => {
      session.status = "exited";
      this.sessions.delete(session.sessionId);
      dataSubscription.dispose();
      exitSubscription.dispose();
      void this.logStore.markExited(run.runId, event.exitCode);
      this.emit("exit", {
        sessionId: session.sessionId,
        exitCode: event.exitCode,
      } satisfies PtyExitEvent);
    });

    this.sessions.set(session.sessionId, {
      session,
      pty,
      dataSubscription,
      exitSubscription,
    });

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
}
