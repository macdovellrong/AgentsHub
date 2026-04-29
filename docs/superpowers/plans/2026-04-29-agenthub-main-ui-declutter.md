# AgentHub Main UI Declutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move logs behind a button and replace the forwarding panel with chat-message quote forwarding.

**Architecture:** Keep existing IPC and stores. Add renderer-only state for the log drawer and quoted message. Reuse `createForward` plus `sendForward` for quoted sends, and reuse existing run list/raw log UI inside the drawer.

**Tech Stack:** React, TypeScript, CSS, Vitest.

---

### Task 1: Quote Forwarding

**Files:**
- Modify: `desktop/src/renderer/src/App.tsx`
- Modify: `desktop/src/renderer/src/styles.css`

- [ ] Add quoted-message state from event “转发”.
- [ ] Show a quote preview above the chat composer.
- [ ] When quoted and the routed target exists, create a forward and immediately send it.
- [ ] Remove the常驻 forwarding panel from the center stack.

### Task 2: Log Drawer

**Files:**
- Modify: `desktop/src/renderer/src/App.tsx`
- Modify: `desktop/src/renderer/src/styles.css`

- [ ] Add topbar “日志” button and `isLogDrawerOpen` state.
- [ ] Move runs filters/list/raw log into a drawer.
- [ ] Remove runs from the right stack.
- [ ] Keep existing `loadRunRawLog` behavior unchanged.

### Task 3: Verification

**Files:**
- Modify only renderer files unless type errors require minor shared updates.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Restart Electron dev app with `REMOTE_DEBUGGING_PORT=9223`.
