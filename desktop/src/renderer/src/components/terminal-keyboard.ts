import type { ProfileKind } from "../../../shared/ipc";

type TerminalKeyEvent = {
  key: string;
  code?: string;
  shiftKey: boolean;
  type: string;
};

type TerminalInputSender = (request: { sessionId: string; data: string; source: "user" }) => Promise<void> | void;

export const TERMINAL_SOFT_NEWLINE_SEQUENCE = "\n";
export const CODEX_TERMINAL_SOFT_NEWLINE_SEQUENCE = "\x1b\r";

export function isTerminalSoftNewlineKey(event: TerminalKeyEvent): boolean {
  const isEnterKey = event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter";
  return event.type === "keydown" && isEnterKey && event.shiftKey;
}

export function resolveTerminalSoftNewlineSequence(profileKind: ProfileKind | null | undefined): string {
  if (profileKind === "codex") {
    return CODEX_TERMINAL_SOFT_NEWLINE_SEQUENCE;
  }
  return TERMINAL_SOFT_NEWLINE_SEQUENCE;
}

export async function sendTerminalSoftNewline(
  sessionId: string | null,
  profileKind: ProfileKind | null | undefined,
  sendTerminalInput: TerminalInputSender,
  pendingCompositionText = "",
): Promise<boolean> {
  if (!sessionId) {
    return false;
  }
  if (pendingCompositionText) {
    await sendTerminalInput({
      sessionId,
      data: pendingCompositionText,
      source: "user",
    });
  }
  await sendTerminalInput({
    sessionId,
    data: resolveTerminalSoftNewlineSequence(profileKind),
    source: "user",
  });
  return true;
}
