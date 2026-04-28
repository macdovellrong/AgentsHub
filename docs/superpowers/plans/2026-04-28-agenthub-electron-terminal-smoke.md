# AgentHub Electron Terminal Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Electron desktop slice: one Windows PowerShell ConPTY session rendered through xterm.js, with input, resize, stop, and raw log persistence.

**Architecture:** Add a parallel `desktop/` Electron app beside the existing Python prototype. Electron main owns node-pty sessions and file writes; renderer owns React UI and xterm.js rendering; IPC is the only bridge between them.

**Tech Stack:** Electron, electron-vite, React, TypeScript, node-pty, @xterm/xterm, @xterm/addon-fit, Vitest.

---

## Scope Check

This plan implements only Phase 1 from `docs/superpowers/specs/2026-04-28-agenthub-electron-terminal-migration-design.md`: Electron terminal smoke. It does not implement Codex/Claude/Gemini profiles, central result flow, task board migration, run history migration, or planner -> implementer -> reviewer orchestration. Those should be separate plans after this terminal slice is verified.

## File Structure

- Create `desktop/package.json`: npm scripts and dependency declarations for Electron terminal smoke.
- Create `desktop/tsconfig.json`: shared TypeScript settings.
- Create `desktop/electron.vite.config.ts`: electron-vite build config for main, preload, and renderer.
- Create `desktop/src/renderer/index.html`: renderer HTML mount point.
- Create `desktop/src/shared/ipc.ts`: IPC channel constants and shared request/event types.
- Create `desktop/src/main/log-store.ts`: create run directories and append raw PTY logs.
- Create `desktop/src/main/pty-session-manager.ts`: node-pty session lifecycle, output fan-out, input, resize, stop.
- Create `desktop/src/main/index.ts`: Electron BrowserWindow and IPC handlers.
- Create `desktop/src/preload/index.ts`: safe renderer API exposed through `contextBridge`.
- Create `desktop/src/renderer/src/main.tsx`: React entry.
- Create `desktop/src/renderer/src/App.tsx`: smoke UI shell.
- Create `desktop/src/renderer/src/components/TerminalPane.tsx`: xterm.js terminal component.
- Create `desktop/src/renderer/src/styles.css`: terminal-focused desktop styling.
- Create `desktop/src/renderer/src/vite-env.d.ts`: renderer global API declarations.
- Create `desktop/src/shared/ipc.test.ts`: IPC channel/type guard tests.
- Create `desktop/src/main/log-store.test.ts`: raw log persistence tests.
- Create `desktop/src/main/pty-session-manager.test.ts`: mocked PTY lifecycle tests.
- Modify `README.md`: add Electron smoke commands.
- Modify `AGENTS.md`: mark the plan as completed and the Electron smoke implementation as the next task.

## Task 1: Scaffold The Electron Workspace

**Files:**
- Create: `desktop/package.json`
- Create: `desktop/tsconfig.json`
- Create: `desktop/electron.vite.config.ts`
- Create: `desktop/src/renderer/index.html`

- [ ] **Step 1: Create package metadata and scripts**

Create `desktop/package.json`:

```json
{
  "name": "agenthub-desktop",
  "version": "0.1.0",
  "private": true,
  "description": "AgentHub Electron terminal smoke",
  "main": "out/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "postinstall": "electron-rebuild -f -w node-pty"
  },
  "dependencies": {
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/xterm": "^5.5.0",
    "node-pty": "^1.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "electron": "^38.0.0",
    "electron-rebuild": "^3.2.9",
    "electron-vite": "^4.0.0",
    "typescript": "^5.9.0",
    "vite": "^7.0.0",
    "vitest": "^4.0.0"
  }
}
```

- [ ] **Step 2: Add TypeScript configuration**

Create `desktop/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "electron.vite.config.ts"],
  "references": []
}
```

- [ ] **Step 3: Add electron-vite config**

Create `desktop/electron.vite.config.ts`:

```ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
});
```

- [ ] **Step 4: Add renderer HTML shell**

Create `desktop/src/renderer/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AgentHub</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Install dependencies**

Run:

```powershell
cd desktop
npm install
```

Expected: `node_modules/` and `package-lock.json` are created, and `electron-rebuild` rebuilds `node-pty` for Electron.

- [ ] **Step 6: Commit scaffold**

Run:

```powershell
git add desktop/package.json desktop/package-lock.json desktop/tsconfig.json desktop/electron.vite.config.ts desktop/src/renderer/index.html
git commit -m "feat: scaffold electron desktop app"
```

## Task 2: Define The IPC Contract

**Files:**
- Create: `desktop/src/shared/ipc.ts`
- Create: `desktop/src/shared/ipc.test.ts`

- [ ] **Step 1: Write failing IPC tests**

Create `desktop/src/shared/ipc.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  IpcChannels,
  isTerminalDataEvent,
  isSessionExitEvent,
  type TerminalDataEvent,
} from "./ipc";

describe("IPC contract", () => {
  it("uses stable channel names", () => {
    expect(IpcChannels.WorkspaceDefault).toBe("workspace:getDefault");
    expect(IpcChannels.StartPowerShell).toBe("agent:startPowerShell");
    expect(IpcChannels.TerminalData).toBe("terminal:data");
  });

  it("recognizes terminal data events", () => {
    const event: TerminalDataEvent = {
      sessionId: "session-1",
      data: "\u001b[32mready\u001b[0m",
    };

    expect(isTerminalDataEvent(event)).toBe(true);
    expect(isTerminalDataEvent({ sessionId: "session-1" })).toBe(false);
  });

  it("recognizes session exit events", () => {
    expect(isSessionExitEvent({ sessionId: "session-1", exitCode: 0 })).toBe(true);
    expect(isSessionExitEvent({ sessionId: "session-1", exitCode: "0" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd desktop
npm test -- src/shared/ipc.test.ts
```

Expected: FAIL because `src/shared/ipc.ts` does not exist.

- [ ] **Step 3: Implement IPC types**

Create `desktop/src/shared/ipc.ts`:

```ts
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
```

- [ ] **Step 4: Run IPC tests**

Run:

```powershell
cd desktop
npm test -- src/shared/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit IPC contract**

Run:

```powershell
git add desktop/src/shared/ipc.ts desktop/src/shared/ipc.test.ts
git commit -m "feat: define electron ipc contract"
```

## Task 3: Add Raw Run Log Persistence

**Files:**
- Create: `desktop/src/main/log-store.ts`
- Create: `desktop/src/main/log-store.test.ts`

- [ ] **Step 1: Write failing log store tests**

Create `desktop/src/main/log-store.test.ts`:

```ts
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunLogStore } from "./log-store";

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("RunLogStore", () => {
  it("creates run metadata and appends raw terminal data", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-log-"));
    const store = new RunLogStore();

    const run = await store.createRun({
      workspacePath,
      profileId: "powershell",
      command: "powershell.exe",
      args: ["-NoLogo"],
    });

    await store.appendRaw(run.runId, "hello\r\n");
    await store.appendRaw(run.runId, "\u001b[32mgreen\u001b[0m\r\n");

    await expect(stat(run.rawLogPath)).resolves.toBeDefined();
    await expect(readFile(run.rawLogPath, "utf8")).resolves.toBe("hello\r\n\u001b[32mgreen\u001b[0m\r\n");

    const meta = JSON.parse(await readFile(run.metaPath, "utf8"));
    expect(meta.profileId).toBe("powershell");
    expect(meta.command).toBe("powershell.exe");
    expect(meta.status).toBe("running");
  });

  it("marks a run exited", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-log-"));
    const store = new RunLogStore();
    const run = await store.createRun({
      workspacePath,
      profileId: "powershell",
      command: "powershell.exe",
      args: [],
    });

    await store.markExited(run.runId, 0);

    const meta = JSON.parse(await readFile(run.metaPath, "utf8"));
    expect(meta.status).toBe("exited");
    expect(meta.exitCode).toBe(0);
    expect(typeof meta.endedAt).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd desktop
npm test -- src/main/log-store.test.ts
```

Expected: FAIL because `RunLogStore` is missing.

- [ ] **Step 3: Implement log store**

Create `desktop/src/main/log-store.ts`:

```ts
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type CreateRunInput = {
  workspacePath: string;
  profileId: string;
  command: string;
  args: string[];
};

export type RunRecord = {
  runId: string;
  workspacePath: string;
  runPath: string;
  rawLogPath: string;
  metaPath: string;
};

type RunMeta = {
  runId: string;
  profileId: string;
  command: string;
  args: string[];
  workspacePath: string;
  status: "running" | "exited";
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
};

export class RunLogStore {
  private readonly runs = new Map<string, RunRecord>();

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const runId = this.createRunId(input.profileId);
    const runPath = path.join(input.workspacePath, ".agenthub", "runs", runId);
    const rawLogPath = path.join(runPath, "raw.log");
    const metaPath = path.join(runPath, "meta.json");

    await mkdir(runPath, { recursive: true });

    const meta: RunMeta = {
      runId,
      profileId: input.profileId,
      command: input.command,
      args: input.args,
      workspacePath: input.workspacePath,
      status: "running",
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
    };

    await writeFile(rawLogPath, "", "utf8");
    await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

    const record: RunRecord = {
      runId,
      workspacePath: input.workspacePath,
      runPath,
      rawLogPath,
      metaPath,
    };
    this.runs.set(runId, record);
    return record;
  }

  async appendRaw(runId: string, chunk: string): Promise<void> {
    const run = this.requireRun(runId);
    await appendFile(run.rawLogPath, chunk, "utf8");
  }

  async markExited(runId: string, exitCode: number | null): Promise<void> {
    const run = this.requireRun(runId);
    const meta = JSON.parse(await readFile(run.metaPath, "utf8")) as RunMeta;
    meta.status = "exited";
    meta.exitCode = exitCode;
    meta.endedAt = new Date().toISOString();
    await writeFile(run.metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  }

  private requireRun(runId: string): RunRecord {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Unknown run: ${runId}`);
    }
    return run;
  }

  private createRunId(profileId: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const suffix = Math.random().toString(16).slice(2, 10);
    return `${stamp}-${profileId}-${suffix}`;
  }
}
```

- [ ] **Step 4: Run log store tests**

Run:

```powershell
cd desktop
npm test -- src/main/log-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit log store**

Run:

```powershell
git add desktop/src/main/log-store.ts desktop/src/main/log-store.test.ts
git commit -m "feat: persist electron terminal raw logs"
```

## Task 4: Add PTY Session Manager

**Files:**
- Create: `desktop/src/main/pty-session-manager.ts`
- Create: `desktop/src/main/pty-session-manager.test.ts`

- [ ] **Step 1: Write failing PTY manager tests**

Create `desktop/src/main/pty-session-manager.test.ts`:

```ts
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
    expect(factory.options.cols).toBe(100);
    expect(factory.options.rows).toBe(30);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd desktop
npm test -- src/main/pty-session-manager.test.ts
```

Expected: FAIL because `PtySessionManager` is missing.

- [ ] **Step 3: Implement PTY session manager**

Create `desktop/src/main/pty-session-manager.ts`:

```ts
import { EventEmitter } from "node:events";
import process from "node:process";
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
  profileId: string;
  workspacePath: string;
  rawLogPath: string;
  pid: number;
  status: "online" | "exited";
};

export type PtyDataEvent = {
  sessionId: string;
  data: string;
};

export type PtyExitEvent = {
  sessionId: string;
  exitCode: number | null;
};

type StoredSession = PtySession & {
  pty: PtyLike;
};

export class NodePtyFactory implements PtyFactory {
  spawn(command: string, args: string[], options: PtySpawnOptions): PtyLike {
    return nodePty.spawn(command, args, options);
  }
}

export class PtySessionManager extends EventEmitter {
  private readonly ptyFactory: PtyFactory;
  private readonly logStore: RunLogStore;
  private readonly sessions = new Map<string, StoredSession>();

  constructor(input: { ptyFactory?: PtyFactory; logStore: RunLogStore }) {
    super();
    this.ptyFactory = input.ptyFactory ?? new NodePtyFactory();
    this.logStore = input.logStore;
  }

  async startPowerShell(input: StartPowerShellInput): Promise<PtySession> {
    const profileId = "powershell";
    const command = "powershell.exe";
    const args = [
      "-NoLogo",
      "-NoExit",
      "-Command",
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; chcp 65001 | Out-Null; Write-Host 'AgentHub PowerShell ready'",
    ];
    const run = await this.logStore.createRun({
      workspacePath: input.workspacePath,
      profileId,
      command,
      args,
    });

    const pty = this.ptyFactory.spawn(command, args, {
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

    const session: StoredSession = {
      sessionId: `session-${run.runId}`,
      runId: run.runId,
      profileId,
      workspacePath: input.workspacePath,
      rawLogPath: run.rawLogPath,
      pid: pty.pid,
      status: "online",
      pty,
    };

    this.sessions.set(session.sessionId, session);

    pty.onData((data) => {
      void this.logStore.appendRaw(session.runId, data);
      this.emit("data", { sessionId: session.sessionId, data } satisfies PtyDataEvent);
    });

    pty.onExit((event) => {
      session.status = "exited";
      void this.logStore.markExited(session.runId, event.exitCode);
      this.emit("exit", {
        sessionId: session.sessionId,
        exitCode: event.exitCode,
      } satisfies PtyExitEvent);
    });

    return this.toPublicSession(session);
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
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  private toPublicSession(session: StoredSession): PtySession {
    return {
      sessionId: session.sessionId,
      runId: session.runId,
      profileId: session.profileId,
      workspacePath: session.workspacePath,
      rawLogPath: session.rawLogPath,
      pid: session.pid,
      status: session.status,
    };
  }
}
```

- [ ] **Step 4: Run PTY manager tests**

Run:

```powershell
cd desktop
npm test -- src/main/pty-session-manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit PTY manager**

Run:

```powershell
git add desktop/src/main/pty-session-manager.ts desktop/src/main/pty-session-manager.test.ts
git commit -m "feat: manage electron pty sessions"
```

## Task 5: Wire Electron Main And Preload IPC

**Files:**
- Create: `desktop/src/main/index.ts`
- Create: `desktop/src/preload/index.ts`
- Create: `desktop/src/renderer/src/vite-env.d.ts`

- [ ] **Step 1: Implement Electron main process**

Create `desktop/src/main/index.ts`:

```ts
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { IpcChannels, type StartPowerShellRequest } from "../shared/ipc";
import { RunLogStore } from "./log-store";
import { PtySessionManager } from "./pty-session-manager";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sessions = new PtySessionManager({
  logStore: new RunLogStore(),
});

let mainWindow: BrowserWindow | undefined;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#101418",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function registerIpc(): void {
  ipcMain.handle(IpcChannels.WorkspaceDefault, () => process.cwd());

  ipcMain.handle(IpcChannels.StartPowerShell, async (_event, request: StartPowerShellRequest) => {
    const workspacePath = request.workspacePath && request.workspacePath.trim()
      ? request.workspacePath.trim()
      : process.cwd();
    const session = await sessions.startPowerShell({
      workspacePath,
      cols: request.cols,
      rows: request.rows,
    });

    return {
      sessionId: session.sessionId,
      runId: session.runId,
      workspacePath: session.workspacePath,
      status: session.status,
    };
  });

  ipcMain.handle(IpcChannels.TerminalInput, (_event, request: { sessionId: string; data: string }) => {
    sessions.write(request.sessionId, request.data);
  });

  ipcMain.handle(IpcChannels.TerminalResize, (_event, request: { sessionId: string; cols: number; rows: number }) => {
    sessions.resize(request.sessionId, request.cols, request.rows);
  });

  ipcMain.handle(IpcChannels.StopSession, (_event, sessionId: string) => {
    sessions.stop(sessionId);
  });

  sessions.on("data", (event) => {
    mainWindow?.webContents.send(IpcChannels.TerminalData, event);
  });

  sessions.on("exit", (event) => {
    mainWindow?.webContents.send(IpcChannels.SessionExit, event);
  });
}
```

- [ ] **Step 2: Implement preload bridge**

Create `desktop/src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";
import {
  IpcChannels,
  type SessionExitEvent,
  type StartPowerShellRequest,
  type StartPowerShellResponse,
  type TerminalDataEvent,
  type TerminalInputRequest,
  type TerminalResizeRequest,
} from "../shared/ipc";

const api = {
  getDefaultWorkspace(): Promise<string> {
    return ipcRenderer.invoke(IpcChannels.WorkspaceDefault) as Promise<string>;
  },
  startPowerShell(request: StartPowerShellRequest): Promise<StartPowerShellResponse> {
    return ipcRenderer.invoke(IpcChannels.StartPowerShell, request) as Promise<StartPowerShellResponse>;
  },
  terminalInput(request: TerminalInputRequest): Promise<void> {
    return ipcRenderer.invoke(IpcChannels.TerminalInput, request) as Promise<void>;
  },
  terminalResize(request: TerminalResizeRequest): Promise<void> {
    return ipcRenderer.invoke(IpcChannels.TerminalResize, request) as Promise<void>;
  },
  stopSession(sessionId: string): Promise<void> {
    return ipcRenderer.invoke(IpcChannels.StopSession, sessionId) as Promise<void>;
  },
  onTerminalData(callback: (event: TerminalDataEvent) => void): () => void {
    const listener = (_ipcEvent: Electron.IpcRendererEvent, event: TerminalDataEvent) => callback(event);
    ipcRenderer.on(IpcChannels.TerminalData, listener);
    return () => ipcRenderer.off(IpcChannels.TerminalData, listener);
  },
  onSessionExit(callback: (event: SessionExitEvent) => void): () => void {
    const listener = (_ipcEvent: Electron.IpcRendererEvent, event: SessionExitEvent) => callback(event);
    ipcRenderer.on(IpcChannels.SessionExit, listener);
    return () => ipcRenderer.off(IpcChannels.SessionExit, listener);
  },
};

contextBridge.exposeInMainWorld("agenthub", api);
```

- [ ] **Step 3: Add renderer global types**

Create `desktop/src/renderer/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

import type {
  SessionExitEvent,
  StartPowerShellRequest,
  StartPowerShellResponse,
  TerminalDataEvent,
  TerminalInputRequest,
  TerminalResizeRequest,
} from "../../shared/ipc";

declare global {
  interface Window {
    agenthub: {
      getDefaultWorkspace(): Promise<string>;
      startPowerShell(request: StartPowerShellRequest): Promise<StartPowerShellResponse>;
      terminalInput(request: TerminalInputRequest): Promise<void>;
      terminalResize(request: TerminalResizeRequest): Promise<void>;
      stopSession(sessionId: string): Promise<void>;
      onTerminalData(callback: (event: TerminalDataEvent) => void): () => void;
      onSessionExit(callback: (event: SessionExitEvent) => void): () => void;
    };
  }
}
```

- [ ] **Step 4: Run typecheck**

Run:

```powershell
cd desktop
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit IPC wiring**

Run:

```powershell
git add desktop/src/main/index.ts desktop/src/preload/index.ts desktop/src/renderer/src/vite-env.d.ts
git commit -m "feat: wire electron terminal ipc"
```

## Task 6: Build The xterm.js Renderer

**Files:**
- Create: `desktop/src/renderer/src/main.tsx`
- Create: `desktop/src/renderer/src/App.tsx`
- Create: `desktop/src/renderer/src/components/TerminalPane.tsx`
- Create: `desktop/src/renderer/src/styles.css`

- [ ] **Step 1: Add React entry**

Create `desktop/src/renderer/src/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 2: Add xterm terminal component**

Create `desktop/src/renderer/src/components/TerminalPane.tsx`:

```tsx
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";

type TerminalPaneProps = {
  sessionId: string | null;
  onResize(cols: number, rows: number): void;
};

export function TerminalPane({ sessionId, onResize }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "Cascadia Mono, Consolas, monospace",
      fontSize: 14,
      theme: {
        background: "#0f1318",
        foreground: "#d6deeb",
        cursor: "#f8f8f2",
        selectionBackground: "#39424e",
      },
      windowsMode: true,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminal.focus();

    terminal.onData((data) => {
      if (sessionIdRef.current) {
        void window.agenthub.terminalInput({
          sessionId: sessionIdRef.current,
          data,
        });
      }
    });

    const unsubscribeData = window.agenthub.onTerminalData((event) => {
      if (event.sessionId === sessionIdRef.current) {
        terminal.write(event.data);
      }
    });

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      if (sessionIdRef.current) {
        onResize(terminal.cols, terminal.rows);
      }
    });
    observer.observe(containerRef.current);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      unsubscribeData();
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [onResize]);

  return <div ref={containerRef} className="terminal-pane" />;
}
```

- [ ] **Step 3: Add smoke app shell**

Create `desktop/src/renderer/src/App.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import type { StartPowerShellResponse } from "../../shared/ipc";
import { TerminalPane } from "./components/TerminalPane";

export function App() {
  const [workspacePath, setWorkspacePath] = useState("");
  const [session, setSession] = useState<StartPowerShellResponse | null>(null);
  const [status, setStatus] = useState("未启动");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.agenthub.getDefaultWorkspace().then(setWorkspacePath);
  }, []);

  useEffect(() => {
    return window.agenthub.onSessionExit((event) => {
      if (event.sessionId === session?.sessionId) {
        setStatus(`已退出：${event.exitCode ?? "unknown"}`);
      }
    });
  }, [session?.sessionId]);

  const startPowerShell = useCallback(async () => {
    setError(null);
    setStatus("启动中");
    try {
      const nextSession = await window.agenthub.startPowerShell({
        workspacePath,
        cols: 120,
        rows: 36,
      });
      setSession(nextSession);
      setStatus("在线");
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setError(message);
      setStatus("启动失败");
    }
  }, [workspacePath]);

  const stopSession = useCallback(async () => {
    if (!session) {
      return;
    }
    await window.agenthub.stopSession(session.sessionId);
    setStatus("停止中");
  }, [session]);

  const resizeTerminal = useCallback(
    (cols: number, rows: number) => {
      if (!session) {
        return;
      }
      void window.agenthub.terminalResize({
        sessionId: session.sessionId,
        cols,
        rows,
      });
    },
    [session],
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>AgentHub</h1>
          <p>Electron terminal smoke</p>
        </div>
        <div className="status-pill">{status}</div>
      </header>

      <section className="workspace-row">
        <label htmlFor="workspace">Workspace</label>
        <input
          id="workspace"
          value={workspacePath}
          onChange={(event) => setWorkspacePath(event.target.value)}
          spellCheck={false}
        />
        <button type="button" onClick={startPowerShell} disabled={status === "启动中"}>
          启动 PowerShell
        </button>
        <button type="button" onClick={stopSession} disabled={!session}>
          停止
        </button>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="terminal-section">
        <TerminalPane sessionId={session?.sessionId ?? null} onResize={resizeTerminal} />
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Add terminal-focused CSS**

Create `desktop/src/renderer/src/styles.css`:

```css
:root {
  color: #d6deeb;
  background: #101418;
  font-family:
    Inter, "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 900px;
  min-height: 680px;
  overflow: hidden;
}

button,
input {
  font: inherit;
}

.app-shell {
  display: grid;
  grid-template-rows: auto auto auto 1fr;
  height: 100vh;
  padding: 16px;
  gap: 12px;
  background: #101418;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.topbar h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
}

.topbar p {
  margin: 4px 0 0;
  color: #95a3b3;
  font-size: 13px;
}

.status-pill {
  border: 1px solid #334155;
  color: #d6deeb;
  padding: 6px 10px;
  border-radius: 6px;
  background: #151b22;
}

.workspace-row {
  display: grid;
  grid-template-columns: auto minmax(320px, 1fr) auto auto;
  align-items: center;
  gap: 10px;
}

.workspace-row label {
  color: #95a3b3;
  font-size: 13px;
}

.workspace-row input {
  height: 34px;
  border: 1px solid #334155;
  border-radius: 6px;
  background: #0f1318;
  color: #d6deeb;
  padding: 0 10px;
  outline: none;
}

.workspace-row button {
  height: 34px;
  border: 1px solid #3b82f6;
  border-radius: 6px;
  background: #1d4ed8;
  color: white;
  padding: 0 12px;
  cursor: pointer;
}

.workspace-row button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.error-banner {
  border: 1px solid #b91c1c;
  color: #fecaca;
  background: #450a0a;
  padding: 8px 10px;
  border-radius: 6px;
}

.terminal-section {
  min-height: 0;
  border: 1px solid #263241;
  border-radius: 8px;
  overflow: hidden;
  background: #0f1318;
}

.terminal-pane {
  width: 100%;
  height: 100%;
  padding: 8px;
}
```

- [ ] **Step 5: Run typecheck and tests**

Run:

```powershell
cd desktop
npm run typecheck
npm test
```

Expected: typecheck PASS and all Vitest tests PASS.

- [ ] **Step 6: Commit renderer**

Run:

```powershell
git add desktop/src/renderer/src/main.tsx desktop/src/renderer/src/App.tsx desktop/src/renderer/src/components/TerminalPane.tsx desktop/src/renderer/src/styles.css
git commit -m "feat: render powershell with xterm"
```

## Task 7: Verify The Smoke App Manually

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Start the Electron app**

Run:

```powershell
cd desktop
npm run dev
```

Expected: Electron opens an AgentHub window with a workspace field, status pill, start button, stop button, and one terminal pane.

- [ ] **Step 2: Start PowerShell**

In the Electron window, click `启动 PowerShell`.

Expected:

- Status becomes `在线`.
- Terminal shows `AgentHub PowerShell ready`.
- Cursor is interactive inside xterm.js.

- [ ] **Step 3: Verify terminal input and color rendering**

In the xterm terminal, type:

```powershell
Write-Host "GREEN_OK" -ForegroundColor Green
```

Then press Enter.

Expected:

- `GREEN_OK` appears in green inside the terminal.
- The terminal does not append duplicate screen snapshots.
- The terminal remains interactive after the command returns.

- [ ] **Step 4: Verify raw log persistence**

Find the latest run directory under:

```text
<workspace>/.agenthub/runs/
```

Open `raw.log`.

Expected:

- `AgentHub PowerShell ready` appears in the file.
- `GREEN_OK` appears in the file.
- ANSI/control sequences may be present because this is raw terminal evidence.

- [ ] **Step 5: Verify stop behavior**

Click `停止`.

Expected:

- PowerShell session exits.
- Status changes to `已退出：<exit-code>` or `停止中` followed by an exit event.
- `meta.json` in the run directory contains `"status": "exited"`.

- [ ] **Step 6: Update README**

Add this section to `README.md`:

````markdown
## Electron terminal smoke

The PyQt HMI remains available as the current Python prototype. The new terminal
renderer is being built in `desktop/` with Electron, xterm.js, and node-pty.

```powershell
cd desktop
npm install
npm run dev
```

Click `启动 PowerShell` to start a ConPTY-backed PowerShell session rendered by
xterm.js. Raw terminal logs are written under `<workspace>/.agenthub/runs/`.
````

- [ ] **Step 7: Update AGENTS task state**

In `AGENTS.md`, add the completed task:

```markdown
- Electron 终端 smoke 实现计划。
```

Keep these unfinished tasks present:

```markdown
- Electron HMI 新桌面壳，目录计划为 `desktop/`。
- xterm.js + node-pty PowerShell 终端 smoke。
- 多 Agent 独立终端窗口/停靠面板。
```

After the implementation passes manual smoke, change the first two unfinished items to completed.

- [ ] **Step 8: Run final verification**

Run:

```powershell
cd desktop
npm run typecheck
npm test
npm run build
```

Expected:

- TypeScript typecheck passes.
- Vitest tests pass.
- Electron production build completes.

- [ ] **Step 9: Commit verification docs**

Run:

```powershell
git add README.md AGENTS.md
git commit -m "docs: document electron terminal smoke"
```

## Final Acceptance Criteria

- `desktop/` exists and can be installed with `npm install`.
- `npm run dev` opens an Electron app on Windows.
- Clicking `启动 PowerShell` starts a node-pty ConPTY session.
- xterm.js renders PowerShell output with color and interactive input.
- User keystrokes are sent to the live PTY.
- Terminal resize is forwarded to the PTY.
- Stopping the session kills the PTY.
- `raw.log` and `meta.json` are written under `<workspace>/.agenthub/runs/<run-id>/`.
- `npm run typecheck`, `npm test`, and `npm run build` pass.

## Self-Review Notes

- Spec coverage: this plan covers the Electron terminal smoke, ConPTY through node-pty, xterm.js rendering, input, resize, stop, and raw log persistence. It intentionally leaves multi-Agent profiles, central result flow, history, task board, and orchestration for follow-up plans.
- Placeholder scan: no unresolved placeholders or incomplete implementation instructions are present.
- Type consistency: IPC request/event names match between `ipc.ts`, `index.ts`, `preload/index.ts`, and renderer declarations.
