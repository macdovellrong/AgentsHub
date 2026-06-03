type TerminalKeyEvent = {
  key: string;
  shiftKey: boolean;
  type: string;
};

export function isTerminalSoftNewlineKey(event: TerminalKeyEvent): boolean {
  return event.type === "keydown" && event.key === "Enter" && event.shiftKey;
}
