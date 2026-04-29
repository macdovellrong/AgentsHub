# AgentHub Chat Input V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the central chat composer with mention selection, clean terminal sends, and chat-style event bubbles.

**Architecture:** Add pure renderer helpers for mention matching and chat presentation so behavior is testable outside React. Keep IPC unchanged and continue using existing `routeInput`, `appendEvent`, and `terminalInput` calls.

**Tech Stack:** React, TypeScript, Vitest, Electron IPC.

---

### Task 1: Mention And Send Helpers

**Files:**
- Modify: `desktop/src/renderer/src/dashboard-helpers.ts`
- Test: `desktop/src/renderer/src/dashboard-helpers.test.ts`

- [ ] Add failing tests for `findMentionQuery`, `getMentionCandidates`, `applyMentionSelection`, and plain routed terminal sends.
- [ ] Implement helpers using profile id, name, and aliases.
- [ ] Change `buildRoutedTerminalMessage` to return only the user message.
- [ ] Run `npm test -- dashboard-helpers`.

### Task 2: Composer UI

**Files:**
- Modify: `desktop/src/renderer/src/App.tsx`
- Modify: `desktop/src/renderer/src/styles.css`

- [ ] Add mention state and keyboard handling to the central input.
- [ ] Render the mention dropdown above the input.
- [ ] Insert selected mention token into the input.
- [ ] Keep Enter behavior for sending when the dropdown is closed.

### Task 3: Chat Bubbles

**Files:**
- Modify: `desktop/src/renderer/src/App.tsx`
- Modify: `desktop/src/renderer/src/styles.css`

- [ ] Render events as `chat-message` bubbles with alignment by event type.
- [ ] Keep the existing forward action on each message.
- [ ] Auto-scroll the event list when events change.

### Task 4: Verification

**Files:**
- Modify only files above unless a type import requires shared updates.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Restart Electron dev app with `REMOTE_DEBUGGING_PORT=9223`.
