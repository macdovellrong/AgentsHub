# AgentHub Conversation Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build event-driven Claude manager mode and bounded multi-Agent discussion mode on top of the existing AgentHub chat, hook, and PTY infrastructure.

**Architecture:** Add a main-process conversation layer that treats `.agenthub/events.jsonl` as the canonical collaboration bus. Agents do not read UI state; AgentHub parses explicit `<agenthub>` JSON commands from Agent output, writes durable conversation events, and delivers prompts to online PTY sessions.

**Tech Stack:** Electron main process, TypeScript, React renderer, Vitest, existing `EventStore`, `PtySessionManager`, hook receiver, and forwarding infrastructure.

---

## File Map

- Create: `desktop/src/main/agent-command-parser.ts`
  - Parses `<agenthub>...</agenthub>` JSON blocks from Agent messages.
- Create: `desktop/src/main/agent-command-parser.test.ts`
  - Covers valid commands, invalid JSON, unknown actions, and multiple command blocks.
- Create: `desktop/src/main/conversation-store.ts`
  - Persists conversation state under `<workspace>/.agenthub/conversations/`.
- Create: `desktop/src/main/conversation-store.test.ts`
  - Verifies create, update, list, and JSONL recovery behavior.
- Create: `desktop/src/main/conversation-orchestrator.ts`
  - Runs Claude manager mode and roundtable state transitions.
- Create: `desktop/src/main/conversation-orchestrator.test.ts`
  - Tests manager dispatch, observation loop, max step protection, and roundtable turn order.
- Modify: `desktop/src/main/event-store.ts`
  - Extend `AgentHubEvent` fields for conversation metadata.
- Modify: `desktop/src/shared/ipc.ts`
  - Add IPC request/response types for conversation creation, pause, resume, stop, and list.
- Modify: `desktop/src/main/index.ts`
  - Wire conversation IPC, hook receiver observation, and renderer notifications.
- Modify: `desktop/src/renderer/src/App.tsx`
  - Add UI controls for Claude manager and discussion mode.
- Modify: `desktop/src/renderer/src/dashboard-helpers.ts`
  - Add pure helpers for conversation labels and status filtering.
- Modify: `desktop/src/renderer/src/vite-env.d.ts`
  - Expose new preload methods.
- Modify: `desktop/src/preload/index.ts`
  - Bridge new IPC methods.

---

### Task 1: Extend Event Types For Conversation Metadata

**Files:**
- Modify: `desktop/src/main/event-store.ts`
- Modify: `desktop/src/shared/ipc.ts`
- Test: `desktop/src/main/event-store.test.ts`
- Test: `desktop/src/shared/ipc.test.ts`

- [x] Add failing tests that append and list an event with `conversationId`, `taskId`, `parentEventId`, `targetProfileIds`, and `deliveryStatus`.
- [x] Extend `AgentHubEvent` and `AgentHubEventDto` with optional fields:
  - `conversationId?: string`
  - `taskId?: string`
  - `parentEventId?: string`
  - `targetProfileIds?: string[]`
  - `deliveryStatus?: "pending" | "sent" | "observed" | "failed"`
- [x] Update IPC guard tests so `events:appended` still validates when these optional fields exist.
- [x] Run:

```powershell
cd desktop
npm test -- src/main/event-store.test.ts src/shared/ipc.test.ts
```

Expected: all selected tests pass.

### Task 2: Add AgentCommandParser

**Files:**
- Create: `desktop/src/main/agent-command-parser.ts`
- Create: `desktop/src/main/agent-command-parser.test.ts`

- [x] Write tests for parsing this command:

```text
<agenthub>
{"action":"send","target":"codex","task_id":"T-001","message":"Implement task A"}
</agenthub>
```

- [x] Add tests for `ask_user` and `done`.
- [x] Add tests that invalid JSON returns a structured parse error and does not throw.
- [x] Implement exported types:
  - `AgentHubCommand`
  - `ParseAgentHubCommandsResult`
  - `parseAgentHubCommands(text: string)`
- [x] Only allow actions: `send`, `ask_user`, `done`.
- [x] Reject `send` when `target`, `task_id`, or `message` is missing.
- [x] Run:

```powershell
cd desktop
npm test -- src/main/agent-command-parser.test.ts
```

Expected: parser tests pass.

### Task 3: Add ConversationStore

**Files:**
- Create: `desktop/src/main/conversation-store.ts`
- Create: `desktop/src/main/conversation-store.test.ts`

- [x] Write tests for creating a manager conversation with supervisor `claude` and participants `codex`, `gemini`.
- [x] Write tests for updating `status`, `currentStep`, and `updatedAt`.
- [x] Write tests for listing conversations sorted by latest update.
- [x] Implement types:
  - `ConversationMode = "manager" | "roundtable"`
  - `ConversationStatus = "running" | "paused" | "completed" | "failed"`
  - `AgentConversation`
- [x] Persist append-only records to `<workspace>/.agenthub/conversations/conversations.jsonl`.
- [x] Deduplicate by `id` when listing, keeping the latest record.
- [x] Run:

```powershell
cd desktop
npm test -- src/main/conversation-store.test.ts
```

Expected: store tests pass.

### Task 4: Build Claude Manager Orchestrator Core

**Files:**
- Create: `desktop/src/main/conversation-orchestrator.ts`
- Create: `desktop/src/main/conversation-orchestrator.test.ts`
- Modify: `desktop/src/main/forward-service.ts` only if delivery reuse requires a public helper.

- [x] Write a test that starts a manager conversation and sends one initial prompt to the online Claude session.
- [x] Write a test that Claude output containing a `send` command writes to the target Codex session and appends an `agent_forward` event.
- [x] Write a test that a Codex `agent_output` with matching `conversationId` and `taskId` sends an observation prompt back to Claude.
- [x] Write a test that `maxSteps` stops further delivery and marks the conversation `paused` or `failed`.
- [x] Implement constructor dependencies:
  - `ConversationStore`
  - `EventStore`
  - session gateway with `listSessions()` and `write(sessionId, data)`
- [x] Keep first implementation synchronous and deterministic; no timers.
- [x] Run:

```powershell
cd desktop
npm test -- src/main/conversation-orchestrator.test.ts
```

Expected: manager core tests pass.

### Task 5: Wire Hook Results Into Observation Loop

**Files:**
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/main/hook-receiver.ts`
- Test: `desktop/src/main/hook-receiver.test.ts`

- [x] Add a test where a hook payload includes `conversationId` and `taskId`, and the appended `agent_output` preserves both fields.
- [x] In `index.ts`, after hook receiver appends an event, pass it to `ConversationOrchestrator.handleAgentOutput(event)`.
- [x] Ensure renderer still receives `events:appended`.
- [x] Run:

```powershell
cd desktop
npm test -- src/main/hook-receiver.test.ts src/main/conversation-orchestrator.test.ts
```

Expected: hook and orchestrator tests pass.

### Task 6: Add Conversation IPC

**Files:**
- Modify: `desktop/src/shared/ipc.ts`
- Modify: `desktop/src/shared/ipc.test.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/src/vite-env.d.ts`
- Modify: `desktop/src/main/index.ts`

- [x] Add IPC channels:
  - `conversations:list`
  - `conversations:startManager`
  - `conversations:startRoundtable`
  - `conversations:pause`
  - `conversations:resume`
  - `conversations:stop`
- [x] Add tests that channel constants and request guards exist.
- [x] Wire handlers in `index.ts` to `ConversationStore` / `ConversationOrchestrator`.
- [x] Run:

```powershell
cd desktop
npm test -- src/shared/ipc.test.ts
npm run typecheck
```

Expected: IPC tests and typecheck pass.

### Task 7: Add Manager UI Controls

**Files:**
- Modify: `desktop/src/renderer/src/App.tsx`
- Modify: `desktop/src/renderer/src/styles.css`
- Modify: `desktop/src/renderer/src/dashboard-helpers.ts`
- Test: `desktop/src/renderer/src/dashboard-helpers.test.ts`

- [x] Add pure helper tests for conversation status labels and compact participant labels.
- [x] Add a “交给 Claude 管理” button near the central composer.
- [x] When clicked, call `startManagerConversation` with current input text, supervisor `claude`, participants `codex` and `gemini`.
- [x] Show active conversations with status, step count, and pause/continue/stop controls.
- [x] Keep normal `@agent` sending unchanged.
- [x] Run:

```powershell
cd desktop
npm test -- src/renderer/src/dashboard-helpers.test.ts
npm run typecheck
```

Expected: renderer helpers and types pass.

### Task 8: Add Roundtable Mode

**Files:**
- Modify: `desktop/src/main/conversation-orchestrator.ts`
- Modify: `desktop/src/main/conversation-orchestrator.test.ts`
- Modify: `desktop/src/renderer/src/App.tsx`

- [x] Add test for fixed turn order: Claude -> Codex -> Gemini -> Claude summary.
- [x] Add test that `maxRounds` stops automatic delivery.
- [x] Add “新建讨论” UI action using current composer text as topic.
- [x] Show roundtable events in the same conversation timeline.
- [x] Run:

```powershell
cd desktop
npm test -- src/main/conversation-orchestrator.test.ts
npm run typecheck
```

Expected: roundtable tests and typecheck pass.

### Task 9: End-To-End Smoke

**Files:**
- Modify only if verification reveals a bug.

- [ ] Start Electron:

```powershell
cd desktop
npm run dev
```

- [ ] Start Claude, Codex, and Gemini in the same workspace.
- [ ] Send a small function list through “交给 Claude 管理”.
- [ ] Verify Claude emits a structured `send` command.
- [ ] Verify Codex receives the delegated task.
- [ ] Verify Codex hook result appears in the conversation.
- [ ] Verify Claude receives an observation prompt and either continues or ends.
- [ ] Run final checks:

```powershell
cd desktop
npm run typecheck
npm test
npm run build
```

Expected: typecheck, tests, and build pass.
