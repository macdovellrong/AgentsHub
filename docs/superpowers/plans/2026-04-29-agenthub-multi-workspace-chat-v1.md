# AgentHub Multi Workspace Chat V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first usable multi-workspace sidebar and a central chat/result workflow that can save or forward selected Agent output.

**Architecture:** Persist workspace tabs in the Electron main process through a small JSON store. Keep all existing workspace-scoped IPC calls unchanged by passing the active renderer workspace path. Add renderer helpers for workspace session counts and terminal preview snippets, then wire them into the existing React shell.

**Tech Stack:** Electron main process, React renderer, TypeScript, Vitest, xterm.js.

---

### Task 1: Workspace Registry

**Files:**
- Create: `desktop/src/main/workspace-store.ts`
- Test: `desktop/src/main/workspace-store.test.ts`
- Modify: `desktop/src/shared/ipc.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/src/vite-env.d.ts`
- Modify: `desktop/src/main/index.ts`

- [ ] Write tests for initialization, add, activate, and dedupe.
- [ ] Implement `WorkspaceStore` with `workspaces.json` persistence.
- [ ] Add `workspaces:list` and `workspace:activate` IPC contracts.
- [ ] Update `workspace:select` to add/activate without blocking on global write locks.
- [ ] Run `npm test -- workspace-store` and `npm run typecheck`.

### Task 2: Renderer Workspace Tabs

**Files:**
- Modify: `desktop/src/renderer/src/dashboard-helpers.ts`
- Test: `desktop/src/renderer/src/dashboard-helpers.test.ts`
- Modify: `desktop/src/renderer/src/App.tsx`
- Modify: `desktop/src/renderer/src/styles.css`
- Modify: `desktop/src/renderer/src/ui-text.ts`

- [ ] Test helpers for workspace session counts and current-workspace filtering.
- [ ] Add `workspaces` state and refresh methods to `App.tsx`.
- [ ] Render a left-side workspace tab list above profiles.
- [ ] Filter profile online state and terminal tabs by active workspace.
- [ ] Run `npm test -- dashboard-helpers`.

### Task 3: Central Result And Forward Actions

**Files:**
- Modify: `desktop/src/renderer/src/dashboard-helpers.ts`
- Test: `desktop/src/renderer/src/dashboard-helpers.test.ts`
- Modify: `desktop/src/renderer/src/App.tsx`
- Modify: `desktop/src/renderer/src/styles.css`
- Modify: `desktop/src/renderer/src/ui-text.ts`

- [ ] Test terminal preview sanitizing and max-length trimming.
- [ ] Track recent terminal output snippets per session from `terminal:data`.
- [ ] Add “保存为结果” to append an `agent_output` event for the selected session.
- [ ] Add “转发” actions on event cards and “转发最近输出” in terminal dock.
- [ ] Add an immediate send path that creates a forward and calls `forwards:send`.

### Task 4: Verification

**Files:**
- Modify as needed from previous tasks only.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Restart the Electron dev app with `REMOTE_DEBUGGING_PORT=9223`.
- [ ] Verify `workspaces:list` and the current page load through the running app.
