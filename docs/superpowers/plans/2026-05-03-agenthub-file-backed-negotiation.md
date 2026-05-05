# File-Backed Pair Negotiation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace large text forwarding in pair negotiation with file-backed conversation artifacts under `.agenthub/conversations/<conversationId>/`.

**Architecture:** Keep `ConversationOrchestrator` as the workflow controller. Add a focused artifact store for `brief.md`, `memory.md`, `state.json`, turn file naming, and path validation. Agents receive short prompts containing file paths and write full outputs to numbered Markdown turn files.

**Tech Stack:** Electron main process, TypeScript, Vitest, React renderer, existing `EventStore`, `ConversationStore`, hook receiver, xterm/node-pty sessions.

---

## File Map

- Create `desktop/src/main/conversation-artifact-store.ts`: owns conversation artifact paths, initialization, turn path allocation, and safe artifact validation.
- Create `desktop/src/main/conversation-artifact-store.test.ts`: tests directory creation, turn names, and path traversal rejection.
- Modify `desktop/src/main/agent-command-parser.ts`: allow `continue` to use either `message` or `artifact_path`; allow `accept.artifact_path`.
- Modify `desktop/src/main/agent-command-parser.test.ts`: parser tests for artifact-backed commands and invalid missing payloads.
- Modify `desktop/prompts/pair-initial.md`, `desktop/prompts/pair-turn.md`, `desktop/prompts/pair-acceptance.md`: short file-path prompts.
- Modify `desktop/src/main/pair-prompt-templates.test.ts`: assert workspace prompt rendering supports artifact variables.
- Modify `desktop/src/main/conversation-orchestrator.ts`: create artifact directories, validate artifacts, route short prompts, and store artifact metadata in events.
- Modify `desktop/src/main/conversation-orchestrator.test.ts`: cover file-backed pair start, continue, accept, and missing artifact pause.
- Modify `desktop/src/renderer/src/dashboard-helpers.ts`: format artifact-backed events as concise summaries.
- Modify `desktop/src/renderer/src/dashboard-helpers.test.ts`: ensure central chat hides raw control JSON when artifact metadata exists.
- Modify `desktop/src/renderer/src/App.tsx`: use helper-based event descriptions in the chat timeline.

---

### Task 1: Parse Artifact-Backed AgentHub Commands

**Files:**
- Modify: `desktop/src/main/agent-command-parser.ts`
- Modify: `desktop/src/main/agent-command-parser.test.ts`

- [ ] **Step 1: Add failing parser tests**

Add these tests inside the existing parser describe block:

```ts
it("parses continue commands with artifact_path and no inline message", () => {
  const result = parseAgentHubCommands(
    '<agenthub>{"action":"continue","proposal_version":2,"artifact_path":".agenthub/conversations/c1/turns/0002-codex.md","summary":"Review completed"}</agenthub>',
  );

  expect(result.errors).toEqual([]);
  expect(result.commands).toEqual([
    {
      action: "continue",
      proposal_version: 2,
      artifact_path: ".agenthub/conversations/c1/turns/0002-codex.md",
      summary: "Review completed",
    },
  ]);
});

it("parses accept commands with an artifact_path", () => {
  const result = parseAgentHubCommands(
    '<agenthub>{"action":"accept","proposal_version":2,"artifact_path":".agenthub/conversations/c1/turns/0004-codex.md","summary":"Both sides agree"}</agenthub>',
  );

  expect(result.errors).toEqual([]);
  expect(result.commands[0]).toMatchObject({
    action: "accept",
    proposal_version: 2,
    artifact_path: ".agenthub/conversations/c1/turns/0004-codex.md",
    summary: "Both sides agree",
  });
});

it("rejects continue commands that contain neither message nor artifact_path", () => {
  const result = parseAgentHubCommands('<agenthub>{"action":"continue","proposal_version":2}</agenthub>');

  expect(result.commands).toEqual([]);
  expect(result.errors).toMatchObject([
    {
      code: "invalid_command",
      message: 'continue command requires string field "message" or "artifact_path"',
    },
  ]);
});
```

- [ ] **Step 2: Run parser tests and verify failure**

Run:

```powershell
cd desktop
npm test -- agent-command-parser.test.ts
```

Expected: the new artifact tests fail because `continue.message` is still required and `artifact_path` is not preserved.

- [ ] **Step 3: Update command types**

Change the `continue` and `accept` branches of `AgentHubCommand` to:

```ts
  | {
      action: "continue";
      proposal_version: number;
      message?: string;
      artifact_path?: string;
      message_to?: string;
      summary?: string;
      stance?: string;
    }
  | {
      action: "accept";
      proposal_version: number;
      summary: string;
      artifact_path?: string;
      message_to?: string;
      stance?: string;
    }
```

- [ ] **Step 4: Update validation**

In `validateContinueCommand`, replace the required message block with:

```ts
  const message = optionalStringField(value, "message", index, block, "continue");
  if ("error" in message) {
    return message;
  }
  const artifactPath = optionalStringField(value, "artifact_path", index, block, "continue");
  if ("error" in artifactPath) {
    return artifactPath;
  }
  if (!message.field && !artifactPath.field) {
    return invalidCommand(index, block, 'continue command requires string field "message" or "artifact_path"');
  }

  const optional = optionalStringFields(value, ["message_to", "summary", "stance"], index, block, "continue");
```

Add this helper near `optionalStringFields`:

```ts
function optionalStringField(
  value: JsonRecord,
  fieldName: string,
  index: number,
  block: string,
  commandName: string,
): { field: Record<string, string> } | { error: AgentHubCommandParseError } {
  const fieldValue = value[fieldName];
  if (fieldValue === undefined) {
    return { field: {} };
  }
  if (typeof fieldValue !== "string") {
    return invalidCommand(index, block, `${commandName} command optional field "${fieldName}" must be a string`);
  }
  return { field: { [fieldName]: fieldValue } };
}
```

Return the command as:

```ts
      ...(message.field as { message?: string }),
      ...(artifactPath.field as { artifact_path?: string }),
```

In `validateAcceptCommand`, include `"artifact_path"` in the optional field list.

- [ ] **Step 5: Verify parser tests**

Run:

```powershell
cd desktop
npm test -- agent-command-parser.test.ts
```

Expected: parser tests pass.

---

### Task 2: Add Conversation Artifact Store

**Files:**
- Create: `desktop/src/main/conversation-artifact-store.ts`
- Create: `desktop/src/main/conversation-artifact-store.test.ts`

- [ ] **Step 1: Write failing artifact store tests**

Create `desktop/src/main/conversation-artifact-store.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationArtifactStore } from "./conversation-artifact-store";

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("ConversationArtifactStore", () => {
  it("initializes brief, memory, state, and turns directory", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-artifacts-"));
    const store = new ConversationArtifactStore();

    const result = await store.initializePairConversation(workspacePath, {
      conversationId: "conversation-1",
      topic: "Decide architecture",
      participantProfileIds: ["claude", "codex"],
      maxSteps: 6,
    });

    expect(result.briefPath).toBe(".agenthub/conversations/conversation-1/brief.md");
    expect(result.memoryPath).toBe(".agenthub/conversations/conversation-1/memory.md");
    await expect(readFile(path.join(workspacePath, result.briefPath), "utf8")).resolves.toContain("Decide architecture");
    await expect(readFile(path.join(workspacePath, result.memoryPath), "utf8")).resolves.toContain("# 协商记忆");
    await expect(stat(path.join(workspacePath, ".agenthub", "conversations", "conversation-1", "turns"))).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
  });

  it("allocates stable numbered turn paths", () => {
    const store = new ConversationArtifactStore();

    expect(store.turnArtifactPath("conversation-1", 1, "claude")).toBe(
      ".agenthub/conversations/conversation-1/turns/0001-claude.md",
    );
    expect(store.turnArtifactPath("conversation-1", 12, "codex.writer")).toBe(
      ".agenthub/conversations/conversation-1/turns/0012-codex-writer.md",
    );
  });

  it("validates existing turn artifacts and rejects path traversal", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-artifacts-"));
    const store = new ConversationArtifactStore();
    const artifactPath = ".agenthub/conversations/conversation-1/turns/0001-claude.md";
    await mkdir(path.dirname(path.join(workspacePath, artifactPath)), { recursive: true });
    await writeFile(path.join(workspacePath, artifactPath), "content", "utf8");

    await expect(store.validateTurnArtifactPath(workspacePath, "conversation-1", artifactPath)).resolves.toMatchObject({
      relativePath: artifactPath,
    });
    await expect(
      store.validateTurnArtifactPath(workspacePath, "conversation-1", ".agenthub/conversations/conversation-1/turns/../../outside.md"),
    ).rejects.toThrow("Unsafe artifact path");
    await expect(
      store.validateTurnArtifactPath(workspacePath, "conversation-1", ".agenthub/conversations/other/turns/0001-claude.md"),
    ).rejects.toThrow("Artifact path must stay inside the conversation turns directory");
  });
});
```

- [ ] **Step 2: Run artifact tests and verify failure**

Run:

```powershell
cd desktop
npm test -- conversation-artifact-store.test.ts
```

Expected: fails because the store file does not exist.

- [ ] **Step 3: Implement the store**

Create `desktop/src/main/conversation-artifact-store.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type PairConversationArtifactInput = {
  conversationId: string;
  topic: string;
  participantProfileIds: string[];
  maxSteps: number | null;
};

export type PairConversationArtifactPaths = {
  conversationRoot: string;
  briefPath: string;
  memoryPath: string;
  statePath: string;
  turnsPath: string;
};

export type ValidatedArtifactPath = {
  relativePath: string;
  absolutePath: string;
};

export class ConversationArtifactStore {
  async initializePairConversation(
    workspacePath: string,
    input: PairConversationArtifactInput,
  ): Promise<PairConversationArtifactPaths> {
    const paths = this.paths(input.conversationId);
    await mkdir(path.join(workspacePath, paths.turnsPath), { recursive: true });
    await writeFile(path.join(workspacePath, paths.briefPath), `# 协商议题\n\n${input.topic}\n`, "utf8");
    await writeFile(
      path.join(workspacePath, paths.memoryPath),
      "# 协商记忆\n\n## 当前共识\n\n## 关键约束\n\n## 未解决问题\n\n## 下一轮关注点\n",
      "utf8",
    );
    await writeFile(
      path.join(workspacePath, paths.statePath),
      `${JSON.stringify(
        {
          conversationId: input.conversationId,
          participantProfileIds: input.participantProfileIds,
          maxSteps: input.maxSteps,
          latestProposalVersion: null,
          latestArtifactPath: null,
          status: "running",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return paths;
  }

  paths(conversationId: string): PairConversationArtifactPaths {
    const conversationRoot = `.agenthub/conversations/${conversationId}`;
    return {
      conversationRoot,
      briefPath: `${conversationRoot}/brief.md`,
      memoryPath: `${conversationRoot}/memory.md`,
      statePath: `${conversationRoot}/state.json`,
      turnsPath: `${conversationRoot}/turns`,
    };
  }

  turnArtifactPath(conversationId: string, step: number, profileId: string): string {
    const sequence = String(step).padStart(4, "0");
    const safeProfileId = profileId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
    return `.agenthub/conversations/${conversationId}/turns/${sequence}-${safeProfileId}.md`;
  }

  async validateTurnArtifactPath(
    workspacePath: string,
    conversationId: string,
    artifactPath: string,
  ): Promise<ValidatedArtifactPath> {
    const normalized = artifactPath.replace(/\\/g, "/");
    if (path.isAbsolute(normalized) || normalized.split("/").includes("..")) {
      throw new Error("Unsafe artifact path");
    }
    const expectedPrefix = `.agenthub/conversations/${conversationId}/turns/`;
    if (!normalized.startsWith(expectedPrefix) || !normalized.endsWith(".md")) {
      throw new Error("Artifact path must stay inside the conversation turns directory");
    }
    const absolutePath = path.resolve(workspacePath, normalized);
    const turnsRoot = path.resolve(workspacePath, ".agenthub", "conversations", conversationId, "turns");
    const relativeToTurns = path.relative(turnsRoot, absolutePath);
    if (relativeToTurns.startsWith("..") || path.isAbsolute(relativeToTurns)) {
      throw new Error("Artifact path must stay inside the conversation turns directory");
    }
    await readFile(absolutePath, "utf8");
    return { relativePath: normalized, absolutePath };
  }
}
```

- [ ] **Step 4: Verify artifact tests**

Run:

```powershell
cd desktop
npm test -- conversation-artifact-store.test.ts
```

Expected: artifact store tests pass.

---

### Task 3: Convert Pair Prompt Templates to File-Backed Prompts

**Files:**
- Modify: `desktop/prompts/pair-initial.md`
- Modify: `desktop/prompts/pair-turn.md`
- Modify: `desktop/prompts/pair-acceptance.md`
- Modify: `desktop/src/main/pair-prompt-templates.test.ts`

- [ ] **Step 1: Add template rendering tests**

In `pair-prompt-templates.test.ts`, add:

```ts
it("renders file-backed pair prompt variables", () => {
  const rendered = renderPromptTemplate(
    "Brief={{brief_path}}\nMemory={{memory_path}}\nPrevious={{previous_artifact_path}}\nOutput={{output_path}}",
    {
      brief_path: ".agenthub/conversations/c1/brief.md",
      memory_path: ".agenthub/conversations/c1/memory.md",
      previous_artifact_path: ".agenthub/conversations/c1/turns/0001-claude.md",
      output_path: ".agenthub/conversations/c1/turns/0002-codex.md",
    },
  );

  expect(rendered).toContain("Brief=.agenthub/conversations/c1/brief.md");
  expect(rendered).toContain("Output=.agenthub/conversations/c1/turns/0002-codex.md");
});
```

- [ ] **Step 2: Run template tests**

Run:

```powershell
cd desktop
npm test -- pair-prompt-templates.test.ts
```

Expected: existing renderer behavior passes; this confirms variables are supported before changing defaults.

- [ ] **Step 3: Replace default templates**

Use these template contents.

`desktop/prompts/pair-initial.md`:

```md
这是 AgentHub 双人协商的第一轮。

请阅读议题文件：
{{brief_path}}

请把你的完整方案写入：
{{output_path}}

请同步更新协商记忆：
{{memory_path}}

写完文件后，最后只输出一行 AgentHub 控制指令。需要对方审查或修订时输出：
<agenthub>{"action":"continue","proposal_version":1,"artifact_path":"{{output_path}}","summary":"一句话摘要"}</agenthub>

只有你认为方案已经可以交付时，才输出：
<agenthub>{"action":"accept","proposal_version":1,"artifact_path":"{{output_path}}","summary":"认可原因"}</agenthub>

不要把 AgentHub 控制指令交给 Bash、PowerShell 或其他工具执行；直接把它作为正文最后一行输出。
```

`desktop/prompts/pair-turn.md`:

```md
这是 AgentHub 双人协商的下一轮。

议题文件：
{{brief_path}}

当前协商记忆：
{{memory_path}}

上一轮 {{previous_profile}} 的完整输出：
{{previous_artifact_path}}

上一轮摘要：
{{summary}}

请阅读以上文件，必要时可查看同目录 turns/ 下更早的历史文件。

请把你的完整审查、修订意见或新方案写入：
{{output_path}}

请同步更新协商记忆：
{{memory_path}}

如果你认可当前方案，最后输出：
<agenthub>{"action":"accept","proposal_version":{{proposal_version}},"artifact_path":"{{output_path}}","summary":"认可原因"}</agenthub>

如果仍需修改，最后输出：
<agenthub>{"action":"continue","proposal_version":{{next_proposal_version}},"artifact_path":"{{output_path}}","summary":"修改点摘要"}</agenthub>

不要把 AgentHub 控制指令交给 Bash、PowerShell 或其他工具执行；直接把它作为正文最后一行输出。
```

`desktop/prompts/pair-acceptance.md`:

```md
这是 AgentHub 双人协商的认可确认轮。

议题文件：
{{brief_path}}

当前协商记忆：
{{memory_path}}

{{previous_profile}} 已认可方案版本 {{proposal_version}}。

上一轮完整输出：
{{previous_artifact_path}}

上一轮摘要：
{{summary}}

请阅读以上文件。

请把你的确认意见或最终修订写入：
{{output_path}}

请同步更新协商记忆：
{{memory_path}}

如果你也认可这个版本，最后输出：
<agenthub>{"action":"accept","proposal_version":{{proposal_version}},"artifact_path":"{{output_path}}","summary":"认可原因"}</agenthub>

如果你仍然需要修改，最后输出：
<agenthub>{"action":"continue","proposal_version":{{next_proposal_version}},"artifact_path":"{{output_path}}","summary":"修改点摘要"}</agenthub>

不要把 AgentHub 控制指令交给 Bash、PowerShell 或其他工具执行；直接把它作为正文最后一行输出。
```

- [ ] **Step 4: Verify template tests**

Run:

```powershell
cd desktop
npm test -- pair-prompt-templates.test.ts
```

Expected: template tests pass.

---

### Task 4: Start Pair Negotiation With Artifact Files

**Files:**
- Modify: `desktop/src/main/conversation-orchestrator.ts`
- Modify: `desktop/src/main/conversation-orchestrator.test.ts`

- [ ] **Step 1: Add failing start test**

Add a test near the existing pair negotiation start tests:

```ts
it("starts file-backed pair negotiation with brief, memory, and first output path", async () => {
  workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
  const gateway = new FakeSessionGateway();
  gateway.sessions = [
    { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
    { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
  ];
  const conversationStore = new ConversationStore();
  const eventStore = new EventStore();
  const orchestrator = new ConversationOrchestrator(conversationStore, eventStore, gateway);

  const conversation = await orchestrator.startPairNegotiation({
    workspacePath,
    topic: "Decide the file memory design",
    participantProfileIds: ["claude", "codex"],
    maxRounds: 3,
  });

  expect(gateway.writes).toMatchObject([{ sessionId: "claude-session" }]);
  expect(gateway.writes[0].data).toContain(`.agenthub/conversations/${conversation.id}/brief.md`);
  expect(gateway.writes[0].data).toContain(`.agenthub/conversations/${conversation.id}/memory.md`);
  expect(gateway.writes[0].data).toContain(`.agenthub/conversations/${conversation.id}/turns/0001-claude.md`);
  await expect(
    readFile(path.join(workspacePath, ".agenthub", "conversations", conversation.id, "brief.md"), "utf8"),
  ).resolves.toContain("Decide the file memory design");
});
```

- [ ] **Step 2: Run orchestrator tests and verify failure**

Run:

```powershell
cd desktop
npm test -- conversation-orchestrator.test.ts
```

Expected: the new test fails because no artifact directory is created and the prompt lacks artifact paths.

- [ ] **Step 3: Inject artifact store**

In `conversation-orchestrator.ts`, import the store:

```ts
import { ConversationArtifactStore } from "./conversation-artifact-store";
```

Change the constructor:

```ts
  constructor(
    private readonly conversationStore: ConversationStore,
    private readonly eventStore: EventStore,
    private readonly sessions: ConversationSessionGateway,
    private readonly artifacts = new ConversationArtifactStore(),
  ) {}
```

- [ ] **Step 4: Initialize artifacts in `startPairNegotiation`**

After creating the conversation and before finding the first session, add:

```ts
    const artifactPaths = await this.artifacts.initializePairConversation(input.workspacePath, {
      conversationId: conversation.id,
      topic: conversation.topic,
      participantProfileIds: conversation.participantProfileIds,
      maxSteps: conversation.maxSteps,
    });
```

Replace the initial prompt call with:

```ts
    const outputPath = this.artifacts.turnArtifactPath(conversation.id, 1, firstProfileId);
    const prompt = await this.buildInitialPairNegotiationPrompt(input.workspacePath, conversation, {
      briefPath: artifactPaths.briefPath,
      memoryPath: artifactPaths.memoryPath,
      outputPath,
    });
```

Change `buildInitialPairNegotiationPrompt` to accept the path object and render:

```ts
  private buildInitialPairNegotiationPrompt(
    workspacePath: string,
    conversation: AgentConversation,
    paths: { briefPath: string; memoryPath: string; outputPath: string },
  ): Promise<string> {
    return loadAndRenderPairPromptTemplate(workspacePath, "initial", {
      topic: conversation.topic,
      brief_path: paths.briefPath,
      memory_path: paths.memoryPath,
      output_path: paths.outputPath,
    });
  }
```

- [ ] **Step 5: Verify start behavior**

Run:

```powershell
cd desktop
npm test -- conversation-orchestrator.test.ts
```

Expected: the file-backed start test passes. Existing legacy tests may still fail until Task 5 updates turn handling.

---

### Task 5: Continue and Accept Through Artifact Paths

**Files:**
- Modify: `desktop/src/main/conversation-orchestrator.ts`
- Modify: `desktop/src/main/conversation-orchestrator.test.ts`

- [ ] **Step 1: Add failing continue test**

Add:

```ts
it("continues pair negotiation by forwarding artifact paths instead of full text", async () => {
  workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
  const gateway = new FakeSessionGateway();
  gateway.sessions = [
    { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
    { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
  ];
  const conversationStore = new ConversationStore();
  const eventStore = new EventStore();
  const orchestrator = new ConversationOrchestrator(conversationStore, eventStore, gateway);
  const conversation = await orchestrator.startPairNegotiation({
    workspacePath,
    topic: "Review file memory",
    participantProfileIds: ["claude", "codex"],
    maxRounds: 3,
  });
  const artifactPath = `.agenthub/conversations/${conversation.id}/turns/0001-claude.md`;
  await writeFile(path.join(workspacePath, artifactPath), "Full proposal body stored in a file.", "utf8");

  gateway.writes = [];
  await orchestrator.handleAgentOutput(
    workspacePath,
    agentOutput({
      id: "claude-file-turn",
      conversationId: conversation.id,
      profileId: "claude",
      message: `<agenthub>{"action":"continue","proposal_version":1,"artifact_path":"${artifactPath}","summary":"Stored proposal"}</agenthub>`,
    }),
  );

  expect(gateway.writes).toMatchObject([{ sessionId: "codex-session" }]);
  expect(gateway.writes[0].data).toContain(artifactPath);
  expect(gateway.writes[0].data).toContain(`.agenthub/conversations/${conversation.id}/turns/0002-codex.md`);
  expect(gateway.writes[0].data).not.toContain("Full proposal body stored in a file.");
  const forwardEvents = (await eventStore.list(workspacePath)).filter((event) => event.type === "agent_forward");
  expect(forwardEvents.at(-1)).toMatchObject({
    message: "Stored proposal",
    metadata: {
      artifactPath,
      nextArtifactPath: `.agenthub/conversations/${conversation.id}/turns/0002-codex.md`,
    },
  });
});
```

- [ ] **Step 2: Add failing missing artifact test**

Add:

```ts
it("pauses pair negotiation when the reported artifact file is missing", async () => {
  workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-conversation-orchestrator-"));
  const gateway = new FakeSessionGateway();
  gateway.sessions = [
    { sessionId: "claude-session", profileId: "claude", workspacePath, status: "online" },
    { sessionId: "codex-session", profileId: "codex", workspacePath, status: "online" },
  ];
  const conversationStore = new ConversationStore();
  const eventStore = new EventStore();
  const orchestrator = new ConversationOrchestrator(conversationStore, eventStore, gateway);
  const conversation = await orchestrator.startPairNegotiation({
    workspacePath,
    topic: "Missing file case",
    participantProfileIds: ["claude", "codex"],
    maxRounds: 3,
  });

  gateway.writes = [];
  await orchestrator.handleAgentOutput(
    workspacePath,
    agentOutput({
      id: "claude-missing-file",
      conversationId: conversation.id,
      profileId: "claude",
      message: `<agenthub>{"action":"continue","proposal_version":1,"artifact_path":".agenthub/conversations/${conversation.id}/turns/0001-claude.md","summary":"Missing file"}</agenthub>`,
    }),
  );

  expect(gateway.writes).toEqual([]);
  await expect(conversationStore.list(workspacePath)).resolves.toMatchObject([
    { id: conversation.id, status: "paused" },
  ]);
  expect((await eventStore.list(workspacePath)).at(-1)).toMatchObject({
    type: "orchestration_step",
    status: "waiting_artifact",
    parentEventId: "claude-missing-file",
  });
});
```

- [ ] **Step 3: Run orchestrator tests and verify failure**

Run:

```powershell
cd desktop
npm test -- conversation-orchestrator.test.ts
```

Expected: new tests fail because artifact validation and metadata are not wired.

- [ ] **Step 4: Add artifact validation helpers to orchestrator**

Add:

```ts
  private async validatePairNegotiationArtifact(
    workspacePath: string,
    conversation: AgentConversation,
    event: AgentHubEvent,
    artifactPath: string | undefined,
  ): Promise<string | null> {
    if (!artifactPath) {
      return null;
    }
    try {
      const validated = await this.artifacts.validateTurnArtifactPath(workspacePath, conversation.id, artifactPath);
      return validated.relativePath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.conversationStore.update(workspacePath, conversation.id, { status: "paused" });
      await this.eventStore.append(workspacePath, {
        type: "orchestration_step",
        message: `Artifact is not ready: ${artifactPath}`,
        conversationId: conversation.id,
        parentEventId: event.id,
        profileId: event.profileId,
        status: "waiting_artifact",
        error: message,
        metadata: { artifactPath },
      });
      return "__WAITING_ARTIFACT__";
    }
  }
```

Use the sentinel only inside `continuePairNegotiation` and `acceptPairNegotiationProposal`; if it equals `"__WAITING_ARTIFACT__"`, return without delivering.

- [ ] **Step 5: Build file-backed turn prompts**

Change `buildPairNegotiationTurnPrompt` to render artifact paths when `command.artifact_path` exists:

```ts
    const paths = this.artifacts.paths(conversation.id);
    const nextStep = conversation.currentStep + 1;
    const targetProfileId = this.otherPairNegotiationParticipant(conversation, event.profileId ?? "") ?? "";
    const outputPath = this.artifacts.turnArtifactPath(conversation.id, nextStep, targetProfileId);
    return loadAndRenderPairPromptTemplate(workspacePath, "turn", {
      topic: conversation.topic,
      brief_path: paths.briefPath,
      memory_path: paths.memoryPath,
      previous_profile: event.profileId ?? "agent",
      previous_artifact_path: command.artifact_path ?? "",
      output_path: outputPath,
      summary: command.summary ?? "",
      proposal_version: command.proposal_version,
      next_proposal_version: command.proposal_version + 1,
      message: command.message ?? "",
    });
```

Keep the existing legacy `message` path as fallback only when `artifact_path` is absent.

- [ ] **Step 6: Store concise event metadata**

In `deliverPairNegotiationTurn`, compute:

```ts
    const nextArtifactPath = this.artifacts.turnArtifactPath(
      conversation.id,
      conversation.currentStep + 1,
      targetProfileId,
    );
```

Use concise event fields:

```ts
      message: command.summary ?? command.message ?? event.message,
      metadata: {
        agenthubCommand: command,
        artifactPath: "artifact_path" in command ? command.artifact_path : undefined,
        nextArtifactPath,
      },
```

- [ ] **Step 7: Verify orchestrator tests**

Run:

```powershell
cd desktop
npm test -- conversation-orchestrator.test.ts
```

Expected: all orchestrator tests pass. Legacy text-forwarding tests may need expectation updates so they assert fallback behavior only when `message` exists and no `artifact_path` exists.

---

### Task 6: Keep Central Chat Concise for Artifact Events

**Files:**
- Modify: `desktop/src/renderer/src/dashboard-helpers.ts`
- Modify: `desktop/src/renderer/src/dashboard-helpers.test.ts`
- Modify: `desktop/src/renderer/src/App.tsx`

- [ ] **Step 1: Add helper tests**

In `dashboard-helpers.test.ts`, import `describeConversationEvent` and add:

```ts
it("formats artifact-backed agent output as a concise file summary", () => {
  const event: AgentHubEventDto = {
    id: "event-1",
    type: "agent_output",
    timestamp: "2026-05-03T00:00:00.000Z",
    profileId: "claude",
    message:
      '<agenthub>{"action":"continue","proposal_version":1,"artifact_path":".agenthub/conversations/c1/turns/0001-claude.md","summary":"Stored plan"}</agenthub>',
    metadata: {
      agenthubCommand: {
        action: "continue",
        proposal_version: 1,
        artifact_path: ".agenthub/conversations/c1/turns/0001-claude.md",
        summary: "Stored plan",
      },
    },
  };

  expect(describeConversationEvent(event)).toBe("claude 已写入 .agenthub/conversations/c1/turns/0001-claude.md：Stored plan");
});
```

- [ ] **Step 2: Run helper tests and verify failure**

Run:

```powershell
cd desktop
npm test -- dashboard-helpers.test.ts
```

Expected: fails because `describeConversationEvent` does not exist.

- [ ] **Step 3: Add helper implementation**

In `dashboard-helpers.ts`, add:

```ts
export function describeConversationEvent(event: AgentHubEventDto): string {
  const artifactSummary = describeArtifactBackedEvent(event);
  if (artifactSummary) {
    return artifactSummary;
  }
  if (event.message) {
    return event.message;
  }
  if (event.error) {
    return event.error;
  }
  if (event.type === "session_started") {
    return `${event.profileName ?? event.profileId ?? "Session"} 已启动`;
  }
  if (event.type === "session_exited") {
    return `${event.profileName ?? event.profileId ?? "Session"} 已退出`;
  }
  return event.type.replace(/_/g, " ");
}

function describeArtifactBackedEvent(event: AgentHubEventDto): string | null {
  const command = event.metadata?.agenthubCommand;
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    return null;
  }
  const artifactPath = "artifact_path" in command && typeof command.artifact_path === "string" ? command.artifact_path : null;
  const summary = "summary" in command && typeof command.summary === "string" ? command.summary : null;
  if (!artifactPath) {
    return null;
  }
  const actor = event.profileName ?? event.profileId ?? "Agent";
  return `${actor} 已写入 ${artifactPath}${summary ? `：${summary}` : ""}`;
}
```

- [ ] **Step 4: Use helper in App**

In `App.tsx`, import `describeConversationEvent` from `dashboard-helpers`, delete the local `describeEvent` function, and render:

```tsx
<p>{describeConversationEvent(event)}</p>
```

- [ ] **Step 5: Verify renderer helper tests**

Run:

```powershell
cd desktop
npm test -- dashboard-helpers.test.ts
```

Expected: helper tests pass.

---

### Task 7: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
cd desktop
npm test -- agent-command-parser.test.ts conversation-artifact-store.test.ts pair-prompt-templates.test.ts conversation-orchestrator.test.ts dashboard-helpers.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
cd desktop
npm run typecheck
```

Expected: TypeScript exits with code 0.

- [ ] **Step 3: Run full test suite**

Run:

```powershell
cd desktop
npm test
```

Expected: all Vitest files pass.

- [ ] **Step 4: Run production build**

Run:

```powershell
cd desktop
npm run build
```

Expected: Electron Vite builds main, preload, and renderer without errors.

- [ ] **Step 5: Manual smoke**

Run:

```powershell
cd desktop
npm run dev
```

Manual checks:

- Start Claude and Codex in the same workspace.
- Start 双人协商 with a short topic.
- Confirm `.agenthub/conversations/<conversationId>/brief.md`, `memory.md`, and `turns/0001-claude.md` paths are sent to Claude.
- Confirm the next Codex prompt references paths instead of pasting Claude’s full answer.
- Confirm central chat shows summaries and artifact paths only.

