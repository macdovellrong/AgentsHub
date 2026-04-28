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

let workspacePath: string | undefined;

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
    manager.on("data", (event) => chunks.push(event.data));

    const session = await manager.startPowerShell({
      workspacePath,
      cols: 100,
      rows: 30,
    });

    factory.pty.emit("data", "hello\r\n");

    expect(factory.command.toLowerCase()).toContain("powershell");
    expect(factory.args.join(" ")).toContain("OutputEncoding");
    expect(factory.options?.cols).toBe(100);
    expect(factory.options?.rows).toBe(30);
    expect(session.status).toBe("online");
    expect(chunks).toEqual(["hello\r\n"]);
    await expect(readFile(session.rawLogPath, "utf8")).resolves.toBe("hello\r\n");
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
