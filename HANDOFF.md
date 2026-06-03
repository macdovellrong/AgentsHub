# HANDOFF

Updated: 2026-06-03 16:49:31 +08:00

## Goal

Fix AgentHub desktop terminal input so Codex can insert a soft newline with Shift+Enter, including after English input and while using Chinese IME. Claude and Gemini already work.

## Current Progress

- Repo: `V:\AgentGroup`
- Branch: `master`
- Main app: `desktop/` Electron + React + xterm.js + node-pty.
- The Codex newline issue is still unresolved. The user manually tested the latest local implementation and reported it still does not work.
- Current uncommitted implementation changed the Codex path to follow Codex source more directly:
  - `desktop/src/renderer/src/components/terminal-keyboard.ts` now sends `"\n"` for soft newline.
  - If IME pending text exists, `TerminalPane` sends the pending text first, then sends `"\n"` as a separate terminal input.
  - Old local Codex draft rewrite helper was deleted:
    - `desktop/src/renderer/src/components/terminal-codex-draft.ts`
    - `desktop/src/renderer/src/components/terminal-codex-draft.test.ts`
  - New IME helper exists:
    - `desktop/src/renderer/src/components/terminal-composition.ts`
    - `desktop/src/renderer/src/components/terminal-composition.test.ts`

## What Worked

- Claude/Gemini soft newline path has consistently worked with plain `"\n"`.
- Collaboration-area multiline send to Codex can work when AgentHub sends full multiline text programmatically; main process uses bracketed paste for submitted multiline program input.
- Automated tests pass for the current attempted implementation:
  - `cd desktop; npm run typecheck`
  - `cd desktop; npm test`
  - `cd desktop; npm run build`

## What Did Not Work

1. Sending CSI-u Shift+Enter (`"\x1b[13;2u"`) to Codex did not insert a newline in the real app.
   - Logs showed AgentHub wrote the sequence to the PTY, but Codex did not act on it.

2. Rewriting the tracked Codex draft via backspaces plus bracketed paste was the wrong route.
   - It tried to maintain a local mirror of the Codex input draft and replace it with `ESC[200~...ESC[201~`.
   - This was fragile with xterm/IME and eventually made even pure English Shift+Enter fail according to user testing.
   - The old helper has now been removed from the local working tree.

3. Current Ctrl-J/LF route is still failing in manual testing.
   - Codex source suggests C0 LF should map to editor insert_newline.
   - The user's latest manual test says it still does not work in AgentHub, so the actual failure is likely in the xterm -> AgentHub IPC -> node-pty -> Codex/crossterm translation path.

## Evidence

- User-reported active debug logs have been under workspace `.agenthub`, examples:
  - `V:\AgentGroup\.agenthub\terminal-input-debug.log`
  - `V:\Gold_Agent\.agenthub\terminal-input-debug.log`
- Important: the app may be testing against the selected workspace, not necessarily repo root. Check the active workspace's `.agenthub/terminal-input-debug.log`.

- Codex source was cloned locally during investigation:
  - `C:\Users\saber\AppData\Local\Temp\openai-codex-src`
  - Re-clone if missing: `git clone --depth 1 https://github.com/openai/codex %TEMP%\openai-codex-src`

- Codex source references from that clone:
  - `codex-rs/tui/src/keymap.rs`
    - `composer.submit` default includes plain Enter.
    - `editor.insert_newline` default includes Ctrl+J, Ctrl+M, plain Enter, Shift+Enter, Alt+Enter.
  - `codex-rs/tui/src/bottom_pane/chat_composer.rs`
    - submit keys are checked before generic textarea editing.
  - `codex-rs/tui/src/bottom_pane/textarea.rs`
    - `input_with_keymap` inserts `"\n"` only when `editor.insert_newline` is matched.
    - Test `c0_line_feed_inserts_newline_through_insert_newline_keymap` sends `KeyCode::Char('\u{000a}')` and expects `a\nb`.
  - `codex-rs/tui/src/tui/event_stream.rs`
    - crossterm `Event::Paste` maps to Codex `TuiEvent::Paste`.
  - `codex-rs/tui/src/tui.rs`
    - Codex enables bracketed paste and attempts keyboard enhancement.

- Current git status before this handoff:
  - Modified:
    - `desktop/src/main/workspace-store.ts`
    - `desktop/src/main/workspace-store.test.ts`
    - `desktop/src/renderer/src/components/TerminalPane.tsx`
    - `desktop/src/renderer/src/components/terminal-input-queue.test.ts`
    - `desktop/src/renderer/src/components/terminal-keyboard-integration.test.ts`
    - `desktop/src/renderer/src/components/terminal-keyboard.test.ts`
    - `desktop/src/renderer/src/components/terminal-keyboard.ts`
  - Deleted:
    - `desktop/src/renderer/src/components/terminal-codex-draft.ts`
    - `desktop/src/renderer/src/components/terminal-codex-draft.test.ts`
  - Untracked:
    - `.claude/`
    - `.codex/`
    - `.gemini/`
    - `desktop/src/renderer/src/components/terminal-composition.ts`
    - `desktop/src/renderer/src/components/terminal-composition.test.ts`

## Blockers / Risks

- Manual app behavior contradicts current unit tests. The tests are not exercising the real PTY/crossterm path.
- Do not assume `"\n"` works just because Codex unit tests suggest it should. AgentHub may be writing bytes that Windows node-pty/Codex receives differently from crossterm key events.
- Do not commit `.claude/`, `.codex/`, `.gemini/`; they are untracked runtime/config directories.
- There is an unrelated uncommitted workspace persistence fix in `desktop/src/main/workspace-store.ts` and its test. If committing later, split it from the Codex newline fix.

## Next Steps

1. Reproduce with fresh logs in the active workspace:
   - Clear or tail `<active-workspace>\.agenthub\terminal-input-debug.log`.
   - In the app, type `AAA`, press Shift+Enter once in Codex.
   - Confirm exactly what AgentHub writes after the current implementation: expected `source=user`, `length=1`, `preview="\n"`, `hex=0a`.

2. If AgentHub writes `0a` but Codex does nothing, test alternate byte-level representations one at a time:
   - `"\x0a"` (current)
   - `"\x0d"` only if it does not submit, but likely submits.
   - bracketed paste payload containing only newline may be worth testing, but avoid rewriting the whole draft.
   - xterm `terminal.input(...)` may not be appropriate because it feeds local terminal emulation, not necessarily PTY input.

3. Compare with how direct Windows terminals deliver Ctrl+J to Codex:
   - Launch Codex directly in PowerShell/cmd.
   - Press Ctrl+J and observe whether it inserts a newline.
   - If Ctrl+J works directly but AgentHub `0a` does not, the issue is AgentHub/node-pty byte translation or session mode.

4. Add diagnostic logging around every boundary:
   - Renderer `attachCustomKeyEventHandler`: key, shiftKey, pendingCompositionText.
   - Renderer input queue request data hex.
   - Main process `terminalInput` IPC receive.
   - `PtySessionManager.writeImmediately` raw write.
   - Tail Codex visible terminal output if possible.

5. Only after finding the boundary where the intended LF/keyboard event changes, adjust implementation and update tests to cover that boundary. Current tests are insufficient because they only assert renderer helper output.
