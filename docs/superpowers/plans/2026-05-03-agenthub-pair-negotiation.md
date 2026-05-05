# AgentHub Pair Negotiation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-Agent negotiation mode where one Agent starts from a topic, the second Agent responds, and AgentHub alternates messages until both accept the same proposal or the max round limit is reached.

**Architecture:** Reuse the existing `ConversationStore`, `ConversationOrchestrator`, hook-driven `agent_output` loop, and central event stream. Add a new conversation mode `pair_negotiation`; the orchestrator remains the executor and only advances when the current speaker returns structured `<agenthub>` JSON.

**Tech Stack:** Electron main process, TypeScript, Vitest, React renderer, existing AgentHub event/conversation stores.

---

### Task 1: Conversation Model

**Files:**
- Modify: `desktop/src/main/conversation-store.ts`
- Modify: `desktop/src/main/conversation-store.test.ts`

- [ ] Add `pair_negotiation` to `ConversationMode`.
- [ ] Persist and reload the new mode through existing JSONL/state files.
- [ ] Add a store test that creates a `pair_negotiation` conversation and verifies `mode`, participants, max steps, and current step.

### Task 2: Command Parser

**Files:**
- Modify: `desktop/src/main/agent-command-parser.ts`
- Modify: `desktop/src/main/agent-command-parser.test.ts`

- [ ] Add support for `accept` and `continue` actions.
- [ ] Parse optional `stance`, `summary`, `proposal_version`, and `message_to`.
- [ ] Keep unknown actions rejected.
- [ ] Add parser tests for valid `accept`, valid `continue`, and invalid missing summary/message.

### Task 3: Pair Negotiation Orchestrator

**Files:**
- Modify: `desktop/src/main/conversation-orchestrator.ts`
- Modify: `desktop/src/main/conversation-orchestrator.test.ts`

- [ ] Add `startPairNegotiation({ workspacePath, topic, participantProfileIds, maxRounds })`.
- [ ] Send the initial prompt to the first participant.
- [ ] On current speaker output:
  - parse `<agenthub>` command;
  - if `continue`, send a turn prompt to the other participant;
  - if `accept`, mark that speaker accepted the current proposal and send the accepted summary to the other participant;
  - if both participants accept the same `proposal_version`, complete the conversation;
  - if max steps is reached, pause with an `orchestration_step`.
- [ ] Add tests for alternating delivery, accepted completion, max-round pause, and ignored out-of-turn output.

### Task 4: IPC and UI Entry

**Files:**
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/preload.ts`
- Modify: `desktop/src/renderer/App.tsx`
- Modify: relevant renderer tests under `desktop/src/renderer`

- [ ] Add an IPC method to start pair negotiation.
- [ ] Add a UI action near conversation controls: `双人协商`.
- [ ] Use default participants `claude` and `codex` when both are online.
- [ ] Show conversation status through existing event timeline.

### Task 5: Verification

**Commands:**

```powershell
cd desktop
npm run typecheck
npm test
npm run build
```

Expected: typecheck exits 0, all Vitest tests pass, and production build exits 0.
