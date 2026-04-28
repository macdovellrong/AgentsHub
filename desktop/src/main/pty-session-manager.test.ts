import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunLogStore } from "./log-store";
import {
  PtySessionManager,
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

  spawn(command: string, args: string[], options: PtySpawnOptions): PtyLike {
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
    expect(factory.args.join(" ")).toContain("OutputEncoding");
    expect(factory.options?.cols).toBe(100);
    expect(factory.options?.rows).toBe(30);
    expect(session.status).toBe("online");
    expect(chunks).toEqual(["hello\r\n"]);
    await expect(readFile(session.rawLogPath, "utf8")).resolves.toBe("hello\r\n");
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
