type TerminalKeyEvent = {
  key: string;
  shiftKey: boolean;
  type: string;
};

type TerminalInputSender = (request: { sessionId: string; data: string; source: "user" }) => Promise<void>;

export const TERMINAL_SHIFT_ENTER_SEQUENCE = "\x1b[13;2u";

export function isTerminalSoftNewlineKey(event: TerminalKeyEvent): boolean {
  return event.type === "keydown" && event.key === "Enter" && event.shiftKey;
}

export async function sendTerminalSoftNewline(
  sessionId: string | null,
  sendTerminalInput: TerminalInputSender,
): Promise<boolean> {
  if (!sessionId) {
    return false;
  }
  await sendTerminalInput({
    sessionId,
    data: TERMINAL_SHIFT_ENTER_SEQUENCE,
    source: "user",
  });
  return true;
}
