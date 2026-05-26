# AgentHub Terminal Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve AgentHub terminal reliability with startup input buffering, terminal output sequencing/ACK, and xterm search.

**Architecture:** Keep the existing Electron + React + node-pty architecture. Add focused helpers around terminal readiness and ACK batching, then thread the new metadata through IPC without changing run/event/chat storage formats.

**Tech Stack:** Electron, React, TypeScript, node-pty, xterm.js, Vitest.

---

## File Structure

- `desktop/src/main/pty-session-manager.ts`: maintain session readiness, input buffer, output seq, unacked byte count, and ACK method.
- `desktop/src/main/terminal-output-ack.ts`: small helper for byte counting and ACK subtraction.
- `desktop/src/main/terminal-input-readiness.ts`: small helper for deciding whether programmatic input should be buffered.
- `desktop/src/shared/ipc.ts`: extend terminal data payload and add terminal ACK request/channel guard.
- `desktop/src/preload/index.ts`: expose `terminalAck`.
- `desktop/src/renderer/src/vite-env.d.ts`: add renderer API type.
- `desktop/src/renderer/src/components/TerminalPane.tsx`: send ACK after xterm writes output; load SearchAddon; add minimal search prompt action.
- `desktop/src/renderer/src/components/terminal-output-ack.ts`: renderer-side ACK batching helper.
- Tests beside changed modules.

## Tasks

### Task 1: Output Seq And ACK Types

- [ ] Add failing IPC guard tests for `TerminalDataEvent.seq`, `TerminalDataEvent.byteLength`, and `TerminalAckRequest`.
- [ ] Extend `IpcChannels`, types, and guards.
- [ ] Expose `terminalAck` through preload and renderer type definitions.
- [ ] Run `npm test -- ipc.test.ts`.

### Task 2: Main Process ACK Accounting

- [ ] Add failing tests for byte counting and ACK subtraction.
- [ ] Add `terminal-output-ack.ts`.
- [ ] Add `outputSeq` and `unackedBytes` to stored sessions.
- [ ] Emit seq/byteLength from `persistAndEmitData`.
- [ ] Add `ack(sessionId, byteLength)` to `PtySessionManager` and IPC handler.
- [ ] Run `npm test -- pty-session-manager.test.ts ipc.test.ts`.

### Task 3: Renderer ACK Batching

- [ ] Add failing tests for ACK batching by byte count and timer.
- [ ] Add renderer `terminal-output-ack.ts`.
- [ ] In `TerminalPane`, call `terminal.write(data, callback)` and ACK after callback.
- [ ] Run related renderer tests.

### Task 4: Startup Input Ready Buffer

- [ ] Add failing `PtySessionManager` tests for programmatic input buffering, first-output flush, timeout flush, and user input bypass.
- [ ] Add readiness helper and session buffer state.
- [ ] Preserve existing bracketed paste and delayed Enter behavior when flushing.
- [ ] Run `npm test -- pty-session-manager.test.ts terminal-input.test.ts`.

### Task 5: SearchAddon

- [ ] Add dependency `@xterm/addon-search`.
- [ ] Load SearchAddon in `TerminalPane`.
- [ ] Add context-menu “查找” action using `window.prompt` and `findNext`.
- [ ] Run `npm run typecheck`.

### Task 6: Full Verification

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
