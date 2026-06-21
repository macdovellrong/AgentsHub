import type { AgentProfileKind } from "./profile-store";
import type { TerminalInputSource } from "./terminal-input-readiness";

export const INPUT_READY_FIRST_OUTPUT_DELAY_MS = 120;
export const INPUT_READY_TIMEOUT_MS = 3000;

export type TerminalInputController = {
  write(data: string, source?: TerminalInputSource): void;
  handleOutput(): void;
  markReady(): void;
  dispose(): void;
};

export type CreateTerminalInputControllerOptions = {
  kind: AgentProfileKind;
  write(data: string): void;
};

export function createTerminalInputController(options: CreateTerminalInputControllerOptions): TerminalInputController {
  let inputReady = false;
  let inputBuffer: string[] = [];
  let inputReadyTimeout: ReturnType<typeof setTimeout> | null = setTimeout(markReady, INPUT_READY_TIMEOUT_MS);
  let firstOutputReadyTimer: ReturnType<typeof setTimeout> | null = null;
  const submitTimers = new Set<ReturnType<typeof setTimeout>>();

  function write(data: string, source: TerminalInputSource = "program"): void {
    if (source === "user" && !inputReady) {
      markReady();
    }
    if (source !== "user" && !inputReady) {
      inputBuffer.push(data);
      return;
    }
    writeImmediately(data, source);
  }

  function writeImmediately(data: string, source: TerminalInputSource = "program"): void {
    if (source === "user") {
      options.write(data);
      return;
    }
    const submittedInput = splitSubmittedTerminalInput(data);
    if (!submittedInput) {
      options.write(data);
      return;
    }
    const terminalInput = shouldUseBracketedPaste(options.kind)
      ? bracketedPaste(submittedInput.text)
      : submittedInput.text;
    options.write(terminalInput);
    for (const delayMs of getSubmitDelays(options.kind, submittedInput.text)) {
      const submitTimer = setTimeout(() => {
        submitTimers.delete(submitTimer);
        options.write("\r");
      }, delayMs);
      submitTimers.add(submitTimer);
    }
  }

  function handleOutput(): void {
    if (inputReady || firstOutputReadyTimer) {
      return;
    }
    firstOutputReadyTimer = setTimeout(markReady, INPUT_READY_FIRST_OUTPUT_DELAY_MS);
  }

  function markReady(): void {
    if (inputReady) {
      return;
    }
    inputReady = true;
    clearInputReadyTimers();
    const buffered = [...inputBuffer];
    inputBuffer = [];
    for (const data of buffered) {
      writeImmediately(data);
    }
  }

  function dispose(): void {
    clearInputReadyTimers();
    for (const submitTimer of submitTimers) {
      clearTimeout(submitTimer);
    }
    submitTimers.clear();
    inputBuffer = [];
  }

  function clearInputReadyTimers(): void {
    if (inputReadyTimeout) {
      clearTimeout(inputReadyTimeout);
      inputReadyTimeout = null;
    }
    if (firstOutputReadyTimer) {
      clearTimeout(firstOutputReadyTimer);
      firstOutputReadyTimer = null;
    }
  }

  return {
    write,
    handleOutput,
    markReady,
    dispose,
  };
}

function splitSubmittedTerminalInput(data: string): { text: string } | null {
  if (data.length <= 1 || !/[\r\n]$/.test(data)) {
    return null;
  }
  return { text: data.replace(/[\r\n]+$/g, "") };
}

function shouldUseBracketedPaste(kind: AgentProfileKind): boolean {
  return kind === "codex" || kind === "claude" || kind === "gemini";
}

function bracketedPaste(text: string): string {
  return `\x1b[200~${normalizePastedText(text)}\x1b[201~`;
}

function normalizePastedText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function getSubmitDelays(kind: AgentProfileKind, text: string): number[] {
  if (!shouldUseBracketedPaste(kind)) {
    return [25];
  }
  const isMultiline = /[\r\n]/.test(text);
  if (kind === "codex" && isMultiline) {
    return [450, 1400];
  }
  return [450];
}
