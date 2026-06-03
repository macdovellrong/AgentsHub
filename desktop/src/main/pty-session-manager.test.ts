import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventStore } from "./event-store";
import { RunLogStore } from "./log-store";
import {
  buildProfileLaunchArgs,
  INPUT_READY_FIRST_OUTPUT_DELAY_MS,
  INPUT_READY_TIMEOUT_MS,
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

class FakeProjectHookInstaller {
  readonly workspaces: string[] = [];

  async install(workspacePath: string): Promise<void> {
    this.workspaces.push(workspacePath);
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

function waitForCondition(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for condition"));
      }
    }, 1);
  });
}

function markReadyForProgrammaticInput(manager: PtySessionManager, sessionId: string, pty: FakePty): void {
  manager.write(sessionId, "ready", "user");
  pty.writes = [];
}

afterEach(async () => {
  vi.useRealTimers();
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("PtySessionManager", () => {
  it("builds resume arguments only for Codex, Claude, and Gemini profiles", () => {
    expect(
      buildProfileLaunchArgs(
        {
          id: "codex",
          name: "Codex",
          kind: "codex",
          command: "codex.cmd",
          args: ["--model", "gpt-5"],
          aliases: [],
          rolePrompt: "",
          env: {},
          defaultCwd: null,
          useWorkspaceWriteLock: true,
        },
        { resumeLast: true, workspacePath: "V:/AgentGroup" },
      ),
    ).toEqual(["--model", "gpt-5", "resume", "--last", "--cd", "V:/AgentGroup"]);
    expect(
      buildProfileLaunchArgs(
        {
          id: "claude",
          name: "Claude",
          kind: "claude",
          command: "claude",
          args: [],
          aliases: [],
          rolePrompt: "",
          env: {},
          defaultCwd: null,
          useWorkspaceWriteLock: false,
        },
        { resumeLast: true },
      ),
    ).toEqual(["--continue"]);
    expect(
      buildProfileLaunchArgs(
        {
          id: "gemini",
          name: "Gemini",
          kind: "gemini",
          command: "gemini.cmd",
          args: ["--model", "gemini-2.5-pro"],
          aliases: [],
          rolePrompt: "",
          env: {},
          defaultCwd: null,
          useWorkspaceWriteLock: false,
        },
        { resumeLast: true },
      ),
    ).toEqual(["--model", "gemini-2.5-pro", "--resume", "latest"]);
    expect(
      buildProfileLaunchArgs(
        {
          id: "custom",
          name: "Custom",
          kind: "custom",
          command: "agent.exe",
          args: ["run"],
          aliases: [],
          rolePrompt: "",
          env: {},
          defaultCwd: null,
          useWorkspaceWriteLock: false,
        },
        { resumeLast: true },
      ),
    ).toEqual(["run"]);
  });

  it("records and spawns the resumed launch arguments", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pty-"));
    const factory = new FakeFactory();
    const logStore = new CapturingLogStore();
    const manager = new PtySessionManager({
      ptyFactory: factory,
      logStore,
    });

    await manager.startProfile(
      {
        id: "codex",
        name: "Codex",
        kind: "codex",
        command: "codex.cmd",
        args: ["--model", "gpt-5"],
        aliases: [],
        rolePrompt: "",
        env: {},
        defaultCwd: null,
        useWorkspaceWriteLock: false,
      },
      workspacePath,
      120,
      40,
      { resumeLast: true },
    );

    expect(factory.args).toEqual(["--model", "gpt-5", "resume", "--last", "--cd", workspacePath]);
    const meta = JSON.parse(await readFile(logStore.lastMetaPath!, "utf8"));
    expect(meta.args).toEqual(["--model", "gpt-5", "resume", "--last", "--cd", workspacePath]);
  });

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

  it("resolves user-level CLI installs when PATH does not include them", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pty-"));
    const userBin = path.join(workspacePath, ".local", "bin");
    const commandPath = path.join(userBin, process.platform === "win32" ? "claude.exe" : "claude");
    await mkdir(userBin, { recursive: true });
    await writeFile(commandPath, "", "utf8");

    const resolved = resolveProfileCommand("claude", {
      PATH: "",
      PATHEXT: ".EXE",
      USERPROFILE: workspacePath,
      HOME: workspacePath,
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
      hookConfig: {
        url: "http://127.0.0.1:38765/api/agent-result",
        token: "test-token",
      },
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
    expect(factory.options?.env.AGENTHUB_HOOK_URL).toBe("http://127.0.0.1:38765/api/agent-result");
    expect(factory.options?.env.AGENTHUB_HOOK_TOKEN).toBe("test-token");
    expect(factory.options?.env.AGENTHUB_PROFILE_ID).toBe("codex");
    expect(factory.options?.env.AGENTHUB_SESSION_ID).toBe(session.sessionId);
    expect(factory.options?.env.AGENTHUB_RUN_ID).toBe(session.runId);
    expect(factory.options?.env.AGENTHUB_WORKSPACE).toBe(workspacePath);
    expect(factory.options?.env.AGENTHUB_TEAM_ID).toBe("default");
    expect(session).toMatchObject({
      profileId: "codex",
      profileName: "Codex",
      kind: "codex",
      status: "online",
      workspacePath,
    });
  });

  it("installs project hooks before spawning managed agent profiles", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pty-"));
    const factory = new FakeFactory();
    const projectHooks = new FakeProjectHookInstaller();
    const manager = new PtySessionManager({
      ptyFactory: factory,
      logStore: new RunLogStore(),
      projectHooks,
    });

    await manager.startProfile(
      {
        id: "codex",
        name: "Codex",
        kind: "codex",
        command: "codex.exe",
        args: [],
        aliases: [],
        rolePrompt: "",
        env: {},
        defaultCwd: null,
        useWorkspaceWriteLock: false,
      },
      workspacePath,
      120,
      40,
    );

    expect(projectHooks.workspaces).toEqual([workspacePath]);
  });

  it("does not install project hooks for PowerShell sessions", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pty-"));
    const projectHooks = new FakeProjectHookInstaller();
    const manager = new PtySessionManager({
      ptyFactory: new FakeFactory(),
      logStore: new RunLogStore(),
      projectHooks,
    });

    await manager.startPowerShell({
      workspacePath,
      cols: 80,
      rows: 24,
    });

    expect(projectHooks.workspaces).toEqual([]);
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

  it("emits sequenced terminal output and tracks acknowledged bytes", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pty-"));
    const factory = new FakeFactory();
    const manager = new PtySessionManager({
      ptyFactory: factory,
      logStore: new RunLogStore(),
    });
    const events: Array<{ sessionId: string; data: string; seq: number; byteLength: number }> = [];
    manager.on("data", (event) => events.push(event));

    const session = await manager.startPowerShell({
      workspacePath,
      cols: 80,
      rows: 24,
    });

    factory.pty.emit("data", "ready");
    factory.pty.emit("data", "中文");
    await waitForCondition(() => events.length === 2);

    expect(events).toEqual([
      { sessionId: session.sessionId, data: "ready", seq: 1, byteLength: 5 },
      { sessionId: session.sessionId, data: "中文", seq: 2, byteLength: 6 },
    ]);
    expect(manager.ack(session.sessionId, 5)).toBe(6);
    expect(manager.ack(session.sessionId, 99)).toBe(0);
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

    manager.write(session.sessionId, "dir", "user");
    manager.resize(session.sessionId, 120, 40);
    manager.stop(session.sessionId);

    expect(factory.pty.writes).toEqual(["dir"]);
    expect(factory.pty.resizes).toEqual([[120, 40]]);
    expect(factory.pty.killed).toBe(true);
  });

  it("buffers programmatic input until the first terminal output settles", async () => {
    vi.useFakeTimers();
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pty-"));
    const factory = new FakeFactory();
    const manager = new PtySessionManager({
      ptyFactory: factory,
      logStore: new RunLogStore(),
    });
    const dataEvent = new Promise<void>((resolve) => {
      manager.on("data", () => resolve());
    });
    const session = await manager.startPowerShell({
      workspacePath,
      cols: 80,
      rows: 24,
    });

    manager.write(session.sessionId, "dir\r\n");
    expect(factory.pty.writes).toEqual([]);

    factory.pty.emit("data", "AgentHub PowerShell ready\r\n");
    await dataEvent;
    await vi.advanceTimersByTimeAsync(INPUT_READY_FIRST_OUTPUT_DELAY_MS);

    expect(factory.pty.writes).toEqual(["dir"]);
    await vi.advanceTimersByTimeAsync(25);
    expect(factory.pty.writes).toEqual(["dir", "\r"]);
  });

  it("flushes buffered programmatic input after the ready timeout", async () => {
    vi.useFakeTimers();
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

    manager.write(session.sessionId, "dir\r\n");
    expect(factory.pty.writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(INPUT_READY_TIMEOUT_MS);

    expect(factory.pty.writes).toEqual(["dir"]);
  });

  it("does not buffer direct user terminal input", async () => {
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

    manager.write(session.sessionId, "dir", "user");

    expect(factory.pty.writes).toEqual(["dir"]);
  });

  it("writes direct user key sequences ending in enter without submit transformation", async () => {
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
        args: [],
        aliases: [],
        rolePrompt: "",
        env: {},
        defaultCwd: null,
        useWorkspaceWriteLock: false,
      },
      workspacePath,
      80,
      24,
    );

    manager.write(session.sessionId, "\x1b\r", "user");

    expect(factory.pty.writes).toEqual(["\x1b\r"]);
  });

  it("submits batched terminal input by writing text and enter separately", async () => {
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
    markReadyForProgrammaticInput(manager, session.sessionId, factory.pty);

    manager.write(session.sessionId, "ask Claude\r\n");

    expect(factory.pty.writes).toEqual(["ask Claude"]);
    await waitForCondition(() => factory.pty.writes.length === 2);
    expect(factory.pty.writes).toEqual(["ask Claude", "\r"]);
  });

  it("submits multiline agent input as bracketed paste before pressing enter", async () => {
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
        args: [],
        aliases: [],
        rolePrompt: "",
        env: {},
        defaultCwd: null,
        useWorkspaceWriteLock: false,
      },
      workspacePath,
      80,
      24,
    );
    markReadyForProgrammaticInput(manager, session.sessionId, factory.pty);

    manager.write(session.sessionId, "line 1\nline 2\r\n");

    expect(factory.pty.writes).toEqual(["\x1b[200~line 1\nline 2\x1b[201~"]);
    await waitForCondition(() => factory.pty.writes.length === 2);
    expect(factory.pty.writes).toEqual(["\x1b[200~line 1\nline 2\x1b[201~", "\r"]);
  });

  it("sends a settled retry enter for long multiline Codex input", async () => {
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
        args: [],
        aliases: [],
        rolePrompt: "",
        env: {},
        defaultCwd: null,
        useWorkspaceWriteLock: false,
      },
      workspacePath,
      80,
      24,
    );
    markReadyForProgrammaticInput(manager, session.sessionId, factory.pty);

    manager.write(session.sessionId, "review this proposal\nwith several lines\nand submit it\r\n");

    await waitForCondition(() => factory.pty.writes.length === 3, 2000);
    expect(factory.pty.writes).toEqual([
      "\x1b[200~review this proposal\nwith several lines\nand submit it\x1b[201~",
      "\r",
      "\r",
    ]);
  });
});
