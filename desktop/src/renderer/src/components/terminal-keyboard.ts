import type { ProfileKind } from "../../../shared/ipc";
import type { CodexTerminalDraftTracker } from "./terminal-codex-draft";

type TerminalKeyEvent = {
  key: string;
  shiftKey: boolean;
  type: string;
};

type TerminalInputSender = (request: { sessionId: string; data: string; source: "user" }) => Promise<void> | void;

export const TERMINAL_SHIFT_ENTER_SEQUENCE = "\x1b[13;2u";
export const DEFAULT_TERMINAL_SHIFT_ENTER_SEQUENCE = "\n";

export function isTerminalSoftNewlineKey(event: TerminalKeyEvent): boolean {
  return event.type === "keydown" && event.key === "Enter" && event.shiftKey;
}

export function resolveTerminalSoftNewlineSequence(profileKind: ProfileKind | null | undefined): string {
  if (profileKind === "codex") {
    return TERMINAL_SHIFT_ENTER_SEQUENCE;
  }
  return DEFAULT_TERMINAL_SHIFT_ENTER_SEQUENCE;
}

export async function sendTerminalSoftNewline(
  sessionId: string | null,
  profileKind: ProfileKind | null | undefined,
  sendTerminalInput: TerminalInputSender,
  codexDraft?: CodexTerminalDraftTracker,
): Promise<boolean> {
  if (!sessionId) {
    return false;
  }
  const codexSoftNewlineInput = profileKind === "codex" ? (codexDraft?.createSoftNewlineInput() ?? null) : null;
  await sendTerminalInput({
    sessionId,
    data: codexSoftNewlineInput ?? resolveTerminalSoftNewlineSequence(profileKind),
    source: "user",
  });
  return true;
}
