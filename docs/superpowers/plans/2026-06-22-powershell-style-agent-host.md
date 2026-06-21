# PowerShell 风格 Agent Host 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `experiment/powershell-style-host` 分支中，把当前直接耦合的 PTY 会话管理改造成 PowerShell 风格的 Host / RawUI / Input / Transcript 分层，同时保留现有 Electron + React + xterm.js + node-pty 技术栈和输入控制能力。

**Architecture:** 继续使用 node-pty/ConPTY 作为真实 TUI 承载层，默认通过 PowerShell shell host 启动 Codex/Claude/Gemini。新增可测试的 `AgentHostSession`、`TerminalTransport`、`RawTerminalState`、`TerminalInputController`、`AgentTranscriptStore` 边界，让 `PtySessionManager` 退化为编排层，`TerminalPane` 退化为渲染层。

**Tech Stack:** TypeScript、Electron、React、xterm.js、node-pty、Vitest、Windows ConPTY、PowerShell。

---

### Task 1: 定义 Host 分层类型和启动计划

**Files:**
- Create: `desktop/src/main/agent-host-types.ts`
- Create: `desktop/src/main/agent-host-launcher.ts`
- Test: `desktop/src/main/agent-host-launcher.test.ts`
- Modify: `desktop/src/main/pty-session-manager.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildAgentHostLaunchPlan } from "./agent-host-launcher";

describe("buildAgentHostLaunchPlan", () => {
  it("keeps user command metadata while spawning PowerShell for managed agents", () => {
    const plan = buildAgentHostLaunchPlan({
      profile: {
        id: "codex",
        name: "Codex",
        kind: "codex",
        command: "codex.cmd",
        args: [],
        aliases: [],
        rolePrompt: "",
        env: {},
        defaultCwd: null,
        launchMode: "powershell",
        useWorkspaceWriteLock: true,
      },
      launchArgs: ["--no-alt-screen", "resume", "--last"],
      cwd: "V:/AgentGroup",
      env: { PATH: "C:/bin" },
    });

    expect(plan.metadata.command).toBe("codex.cmd");
    expect(plan.metadata.args).toEqual(["--no-alt-screen", "resume", "--last"]);
    expect(plan.spawn.command.toLowerCase()).toContain("powershell");
    expect(plan.spawn.args.join(" ")).toContain("Set-Location -LiteralPath");
    expect(plan.host.kind).toBe("powershell");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop; npm test -- agent-host-launcher.test.ts`

Expected: FAIL because `agent-host-launcher.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Implement `AgentHostLaunchPlan`, `AgentHostShellKind`, and `buildAgentHostLaunchPlan`. Move PowerShell/cmd/direct spawn-plan construction out of `pty-session-manager.ts` without changing behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop; npm test -- agent-host-launcher.test.ts pty-session-manager.test.ts`

Expected: PASS.

### Task 2: 增加 RawTerminalState

**Files:**
- Create: `desktop/src/main/raw-terminal-state.ts`
- Test: `desktop/src/main/raw-terminal-state.test.ts`
- Modify: `desktop/src/main/pty-session-manager.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createRawTerminalState } from "./raw-terminal-state";

describe("createRawTerminalState", () => {
  it("tracks size, output bytes, input bytes, and alternate buffer transitions", () => {
    const state = createRawTerminalState({ cols: 80, rows: 24 });
    state.recordOutput("\x1b[?1049hhello");
    state.recordInput("abc");
    state.resize(120, 40);

    expect(state.snapshot()).toMatchObject({
      cols: 120,
      rows: 40,
      outputBytes: 12,
      inputBytes: 3,
      alternateBuffer: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop; npm test -- raw-terminal-state.test.ts`

Expected: FAIL because `raw-terminal-state.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Implement a state object that records `cols`, `rows`, `outputBytes`, `inputBytes`, `alternateBuffer`, and `lastOutputAt`. Detect `\x1b[?1049h`, `\x1b[?1049l`, `\x1b[?47h`, `\x1b[?47l`, `\x1b[?1047h`, `\x1b[?1047l`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop; npm test -- raw-terminal-state.test.ts pty-session-manager.test.ts`

Expected: PASS.

### Task 3: 抽出 TerminalInputController

**Files:**
- Create: `desktop/src/main/terminal-input-controller.ts`
- Test: `desktop/src/main/terminal-input-controller.test.ts`
- Modify: `desktop/src/main/pty-session-manager.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createTerminalInputController } from "./terminal-input-controller";

describe("createTerminalInputController", () => {
  it("passes user input directly and transforms programmatic multiline input for managed agents", () => {
    const writes: string[] = [];
    const controller = createTerminalInputController({
      kind: "codex",
      write: (data) => writes.push(data),
      submitDelays: () => [],
    });

    controller.markReady();
    controller.write("\x1b\r", "user");
    controller.write("line 1\nline 2\r\n", "program");

    expect(writes).toEqual(["\x1b\r", "\x1b[200~line 1\nline 2\x1b[201~"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop; npm test -- terminal-input-controller.test.ts`

Expected: FAIL because `terminal-input-controller.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Move existing buffering, bracketed paste, CR submission, and readiness logic out of `PtySessionManager` into `TerminalInputController`. Keep the same public `manager.write(sessionId, data, source)` behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop; npm test -- terminal-input-controller.test.ts pty-session-manager.test.ts terminal-input-readiness.test.ts`

Expected: PASS.

### Task 4: 增加 AgentTranscriptStore

**Files:**
- Create: `desktop/src/main/agent-transcript-store.ts`
- Test: `desktop/src/main/agent-transcript-store.test.ts`
- Modify: `desktop/src/main/pty-session-manager.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentTranscriptStore } from "./agent-transcript-store";

let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("AgentTranscriptStore", () => {
  it("records semantic terminal events outside raw.log", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "agenthub-transcript-"));
    const store = new AgentTranscriptStore();
    const file = await store.append(dir, "run-1", {
      type: "terminal_output",
      sessionId: "s1",
      profileId: "codex",
      bytes: 5,
      preview: "hello",
    });

    await expect(readFile(file, "utf8")).resolves.toContain("\"terminal_output\"");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop; npm test -- agent-transcript-store.test.ts`

Expected: FAIL because `agent-transcript-store.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Write JSONL events to `<workspace>/.agenthub/runs/<runId>/transcript.jsonl`. Store semantic events only: session started/exited, terminal output metadata, input metadata, alternate-buffer transitions, and hook results if available later.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop; npm test -- agent-transcript-store.test.ts pty-session-manager.test.ts`

Expected: PASS.

### Task 5: 接入 AgentHostSession 编排层

**Files:**
- Create: `desktop/src/main/agent-host-session.ts`
- Test: `desktop/src/main/agent-host-session.test.ts`
- Modify: `desktop/src/main/pty-session-manager.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createAgentHostSession } from "./agent-host-session";

describe("createAgentHostSession", () => {
  it("combines launch metadata, terminal state, and transcript path", () => {
    const session = createAgentHostSession({
      sessionId: "s1",
      runId: "r1",
      profileId: "codex",
      profileName: "Codex",
      kind: "codex",
      workspacePath: "V:/AgentGroup",
      rawLogPath: "V:/AgentGroup/.agenthub/runs/r1/raw.log",
      metaPath: "V:/AgentGroup/.agenthub/runs/r1/meta.json",
      cols: 80,
      rows: 24,
      hostKind: "powershell",
    });

    expect(session.session.kind).toBe("codex");
    expect(session.hostKind).toBe("powershell");
    expect(session.terminalState.snapshot().cols).toBe(80);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop; npm test -- agent-host-session.test.ts`

Expected: FAIL because `agent-host-session.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `AgentHostSession` as a small composition object used by `PtySessionManager` instead of ad-hoc fields. It owns `terminalState` and `inputController`, while the manager still owns IPC-facing session maps.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop; npm test -- agent-host-session.test.ts pty-session-manager.test.ts`

Expected: PASS.

### Task 6: UI 暴露 Host/RawUI 诊断

**Files:**
- Modify: `desktop/src/shared/ipc.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/main/pty-session-manager.ts`
- Modify: `desktop/src/renderer/src/App.tsx`
- Test: existing TypeScript and Vitest coverage

- [ ] **Step 1: Add DTO fields**

Extend session response with optional diagnostic fields:

```ts
hostKind?: "direct" | "powershell" | "cmd";
terminalState?: {
  cols: number;
  rows: number;
  alternateBuffer: boolean;
  outputBytes: number;
  inputBytes: number;
};
```

- [ ] **Step 2: Render compact diagnostics**

In profile/session UI, show `profileKind / hostKind` and an alternate-buffer marker when true. Do not add a large new panel.

- [ ] **Step 3: Verify**

Run: `cd desktop; npm run typecheck; npm test`

Expected: PASS.

### Task 7: Final verification and commit

**Files:**
- All modified implementation and tests

- [ ] **Step 1: Run full verification**

Run:

```powershell
cd desktop
npm run typecheck
npm test
npm run build
```

Expected: typecheck passes, all Vitest tests pass, build exits 0.

- [ ] **Step 2: Commit**

Run:

```powershell
git status --short
git add desktop/src/main desktop/src/shared desktop/src/renderer/src docs/superpowers/plans/2026-06-22-powershell-style-agent-host.md
git commit -m "实验：引入 PowerShell 风格 Agent Host 分层"
```

Expected: commit is created on `experiment/powershell-style-host`.

---

## 自检

- 覆盖目标：Host 分层、RawUI 状态、输入控制、Transcript、UI 诊断、验证命令都有对应任务。
- 边界选择：不替换 Electron/React/xterm/node-pty，不引入 C#/.NET，不删除现有 profile/hook/task/conversation 功能。
- 风险控制：每个新增模块先写失败测试，再迁移现有行为，`PtySessionManager` 对外 API 保持兼容。
