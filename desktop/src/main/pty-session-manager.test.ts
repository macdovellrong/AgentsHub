import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventStore } from "./event-store";
import { RunLogStore } from "./log-store";
import {
  PtySessionManager,
  resolveProfileCommand,
  type PtyFactory,
  type PtyLike,
  type PtySpawnOptions,
} from "./pty-session-manager";

class FakePty extends EventEmitter implements PtyLike {
  pid = 1234;
  writes: string[] = [];
  resizes: Array<[number, number]> = [];
  killed = false;

  onData(callback: (data: string) => void): { dispose: () => void } {
    this.on("data", callback);
    return { dispose: () => this.off("data", callback) };
  }

  onExit(callback: (event: { exitCode: number; signal?: number }) => void): { dispose: () => void } {
    this.on("exit", callback);
    return { dispose: () => this.off("exit", callback) };
  }

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizes.push([cols, rows]);
  }

  kill(): void {
    this.killed = true;
  }
}

class FakeFactory implements PtyFactory {
  pty = new FakePty();
  command = "";
  args: string[] = [];
  options: PtySpawnOptions | undefined;
  spawnError: Error | undefined;

  spawn(command: string, args: string[], options: PtySpawnOptions): PtyLike {
    if (this.spawnError) {
      throw this.spawnError;
    }
    this.command = command;
    this.args = args;
    this.options = options;
    return this.pty;
  }
}

class DelayedLogStore extends RunLogStore {
  appendedChunks: string[] = [];
  appendStarted = false;
  appendFinished = false;
  markExitedStarted = false;
  markExitedFinished = false;
  private releaseAppend: (() => void) | undefined;
  private releaseExit: (() => void) | undefined;

  async appendRaw(runId: string, chunk: string): Promise<void> {
    this.appendStarted = true;
    this.appendedChunks.push(chunk);
    await new Promise<void>((resolve) => {
      this.releaseAppend = resolve;
    });
    await super.appendRaw(runId, chunk);
    this.appendFinished = true;
  }

  async markExited(runId: string, exitCode: number | null): Promise<void> {
    this.markExitedStarted = true;
    await new Promise<void>((resolve) => {
      this.releaseExit = resolve;
    });
    await super.markExited(runId, exitCode);
    this.markExitedFinished = true;
  }

  unblockAppend(): void {
    this.releaseAppend?.();
  }

  unblockExit(): void {
    this.releaseExit?.();
  }
}

class FailingLogStore extends RunLogStore {
  failNextAppend = false;

  async appendRaw(runId: string, chunk: string): Promise<void> {
    if (this.failNextAppend) {
      this.failNextAppend = false;
      throw new Error(`append failed: ${chunk}`);
    }
    await super.appendRaw(runId, chunk);
  }
}

class CapturingLogStore extends RunLogStore {
  lastMetaPath: string | undefined;

  async createRun(input: Parameters<RunLogStore["createRun"]>[0]): Promise<Awaited<ReturnType<RunLogStore["createRun"]>>> {
    const run = await super.createRun(input);
    this.lastMetaPath = run.metaPath;
    return run;
  }
}

let workspacePath: string | undefined;

function waitForCondition(condition: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt > 1000) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for condition"));
      }
    }, 1);
  });
}

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("PtySessionManager", () => {
  it("resolves profile commands from PATH before spawning", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pty-"));
    const commandPath = path.join(workspacePath, process.platform === "win32" ? "agent.cmd" : "agent");
    await writeFile(commandPath, "", "utf8");

    const resolved = resolveProfileCommand("agent", {
      PATH: workspacePath,
      PATHEXT: ".CMD",
    });

    expect(resolved.toLowerCase()).toBe(commandPath.toLowerCase());
  });

  it("starts PowerShell with UTF-8 bootstrap and emits data", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pty-"));
    const factory = new FakeFactory();
    const manager = new PtySessionManager({
      ptyFactory: factory,
      logStore: new RunLogStore(),
    });
    const chunks: string[] = [];
    const dataEvent = new Promise<void>((resolve) => {
      manager.on("data", (event) => {
        chunks.push(event.data);
        resolve();
      });
    });

    const session = await manager.startPowerShell({
      workspacePath,
      cols: 100,
      rows: 30,
    });

    factory.pty.emit("data", "hello\r\n");
    await dataEvent;

    expect(factory.command.toLowerCase()).toContain("powershell");
    expect(factory.args).toContain("-NoProfile");
    expect(factory.args.join(" ")).toContain("OutputEncoding");
    expect(factory.args.join(" ")).toContain("Remove-Module PSReadLine");
    expect(factory.options?.cols).toBe(100);
    expect(factory.options?.rows).toBe(30);
    expect(session.status).toBe("online");
    expect(chunks).toEqual(["hello\r\n"]);
    await expect(readFile(session.rawLogPath, "utf8")).resolves.toBe("hello\r\n");
  });

  it("starts an arbitrary profile with session metadata", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pty-"));
    const factory = new FakeFactory();
    const manager = new PtySessionManager({
      ptyFactory: factory,
      logStore: new RunLogStore(),
    });

    const session = await manager.startProfile(
      {
        id: "codex",
        name: "Codex",
        kind: "codex",
        command: "codex.exe",
        args: ["--model", "gpt-5"],
        aliases: ["code"],
        rolePrompt: "Implement changes.",
        env: { CODEX_HOME: "C:/codex" },
        defaultCwd: null,
        useWorkspaceWriteLock: true,
      },
      workspacePath,
      120,
      40,
    );

    expect(factory.command).toBe("codex.exe");
    expect(factory.args).toEqual(["--model", "gpt-5"]);
    expect(factory.options?.cwd).toBe(workspacePath);
    expect(factory.options?.env.CODEX_HOME).toBe("C:/codex");
    expect(session).toMatchObject({
      profileId: "codex",
      profileName: "Codex",
      kind: "codex",
      status: "online",
      workspacePath,
    });
  });

  it("appends raw data through the log store before emitting data", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pty-"));
    const factory = new FakeFactory();
    const logStore = new DelayedLogStore();
    const manager = new PtySessionManager({
      ptyFactory: factory,
      logStore,
    });
    let emitted = false;
    const dataEvent = new Promise<void>((resolve) => {
      manager.on("data", () => {
        emitted = true;
        resolve();
      });
    });

    const session = await manager.startPowerShell({
      workspacePath,
      cols: 80,
      rows: 24,
    });

    factory.pty.emit("data", "queued\r\n");
    await waitForCondition(() => logStore.appendStarted);

    expect(logStore.appendedChunks).toEqual(["queued\r\n"]);
    expect(emitted).toBe(false);

    logStore.unblockAppend();
    await dataEvent;

    expect(logStore.appendFinished).toBe(true);
    await expect(readFile(session.rawLogPath, "utf8")).resolves.toBe("queued\r\n");
  });

  it("keeps raw PTY output out of workspace events", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pty-"));
    const factory = new FakeFactory();
    const eventStore = new EventStore();
    const manager = new PtySessionManager({
      ptyFactory: factory,
      logStore: new RunLogStore(),
      eventStore,
    });
    const dataEvent = new Promise<void>((resolve) => {
      manager.on("data", () => resolve());
    });

    await manager.startPowerShell({
      workspacePath,
      cols: 80,
      rows: 24,
    });
    factory.pty.emit("data", "\u001b[32mraw terminal frame\u001b[0m\r\n");
    await dataEvent;

    const events = await eventStore.list(workspacePath);
    expect(events.map((event) => event.type)).toEqual(["session_started"]);
  });

  it("persists exit metadata before emitting exit", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pty-"));
    const factory = new FakeFactory();
    const logStore = new DelayedLogStore();
    const manager = new PtySessionManager({
      ptyFactory: factory,
      logStore,
    });
    const session = await manager.startPowerShell({
      workspacePath,
      cols: 80,
      rows: 24,
    });
    const metaPath = path.join(path.dirname(session.rawLogPath), "meta.json");
    const exitEvent = new Promise<boolean>((resolve) => {
      manager.on("exit", async () => {
        const meta = JSON.parse(await readFile(metaPath, "utf8"));
        resolve(logStore.markExitedFinished && meta.status === "exited" && meta.exitCode === 7);
      });
    });

    factory.pty.emit("exit", { exitCode: 7 });
    await waitForCondition(() => logStore.markExitedStarted);

    logStore.unblockExit();

    await expect(exitEvent).resolves.toBe(true);
  });

  it("emits log errors without blocking later data or exit", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pty-"));
    const factory = new FakeFactory();
    const logStore = new FailingLogStore();
    const manager = new PtySessionManager({
      ptyFactory: factory,
      logStore,
    });
    const dataChunks: string[] = [];
    const errors: string[] = [];
    const exitCodes: Array<number | null> = [];
    manager.on("data", (event) => dataChunks.push(event.data));
    manager.on("error", (event) => errors.push(event.message));
    manager.on("exit", (event) => exitCodes.push(event.exitCode));

    const session = await manager.startPowerShell({
      workspacePath,
      cols: 80,
      rows: 24,
    });
    logStore.failNextAppend = true;

    factory.pty.emit("data", "lost\r\n");
    await waitForCondition(() => errors.length === 1);

    factory.pty.emit("data", "kept\r\n");
    await waitForCondition(() => dataChunks.length === 1);
    factory.pty.emit("exit", { exitCode: 0 });
    await waitForCondition(() => exitCodes.length === 1);

    expect(errors[0]).toContain("append failed: lost");
    expect(dataChunks).toEqual(["kept\r\n"]);
    expect(exitCodes).toEqual([0]);
    expect(() => manager.write(session.sessionId, "after-exit")).toThrow(`Unknown session: ${session.sessionId}`);
  });

  it("marks the run exited when PTY spawn fails after run creation", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pty-"));
    const factory = new FakeFactory();
    factory.spawnError = new Error("spawn failed");
    const logStore = new CapturingLogStore();
    const manager = new PtySessionManager({
      ptyFactory: factory,
      logStore,
    });

    await expect(
      manager.startPowerShell({
        workspacePath,
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow("spawn failed");

    expect(logStore.lastMetaPath).toBeDefined();
    const meta = JSON.parse(await readFile(logStore.lastMetaPath!, "utf8"));
    expect(meta.status).toBe("exited");
    expect(meta.exitCode).toBeNull();
  });

  it("writes, resizes, and stops a session", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pty-"));
    const factory = new FakeFactory();
    const manager = new PtySessionManager({
      ptyFactory: factory,
      logStore: new RunLogStore(),
    });

    const session = await manager.startPowerShell({
      workspacePath,
      cols: 80,
      rows: 24,
    });

    manager.write(session.sessionId, "dir\r");
    manager.resize(session.sessionId, 120, 40);
    manager.stop(session.sessionId);

    expect(factory.pty.writes).toEqual(["dir\r"]);
    expect(factory.pty.resizes).toEqual([[120, 40]]);
    expect(factory.pty.killed).toBe(true);
  });
});
