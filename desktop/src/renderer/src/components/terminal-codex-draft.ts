export type CodexTerminalDraftTracker = {
  recordUserInput(data: string): void;
  createSoftNewlineInput(): string | null;
  currentText(): string;
  reset(): void;
};

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const BACKSPACE = "\x7f";
const IGNORED_INPUT_SEQUENCES = new Set(["\x1b[I", "\x1b[O"]);

function removeLastCharacter(text: string): string {
  const characters = Array.from(text);
  characters.pop();
  return characters.join("");
}

function hasUnsupportedControlInput(data: string): boolean {
  for (const character of data) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

function bracketedPaste(text: string): string {
  return `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`;
}

export function createCodexTerminalDraftTracker(): CodexTerminalDraftTracker {
  let text = "";
  let synced = true;

  return {
    recordUserInput: (data) => {
      if (!data || IGNORED_INPUT_SEQUENCES.has(data)) {
        return;
      }

      if (data === "\r") {
        text = "";
        synced = true;
        return;
      }

      if (data === BACKSPACE || data === "\b") {
        text = removeLastCharacter(text);
        return;
      }

      if (hasUnsupportedControlInput(data)) {
        synced = false;
        return;
      }

      text += data;
    },
    createSoftNewlineInput: () => {
      if (!synced) {
        return null;
      }

      const nextText = `${text}\n`;
      const clearCurrentDraft = BACKSPACE.repeat(Array.from(text).length);
      text = nextText;
      return `${clearCurrentDraft}${bracketedPaste(nextText)}`;
    },
    currentText: () => text,
    reset: () => {
      text = "";
      synced = true;
    },
  };
}
