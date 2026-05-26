export type TerminalInputSource = "user" | "program" | undefined;

export function shouldBufferTerminalInput({
  inputReady,
  source,
}: {
  inputReady: boolean;
  source: TerminalInputSource;
}): boolean {
  return !inputReady && source !== "user";
}
