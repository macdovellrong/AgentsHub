type TextareaValue = {
  value: string;
};

export type TerminalCompositionState = {
  start(textareaValue?: string): void;
  update(eventText: string, textareaValue?: string): void;
  finish(): void;
  clear(textarea?: TextareaValue | null): void;
  pendingText(textareaValue?: string): string;
};

export function createTerminalCompositionState(): TerminalCompositionState {
  let composing = false;
  let startLength = 0;
  let pending = "";

  const pendingFromTextarea = (textareaValue?: string): string => {
    if (!composing || textareaValue === undefined || textareaValue.length < startLength) {
      return "";
    }
    return textareaValue.slice(startLength);
  };

  return {
    start: (textareaValue = "") => {
      composing = true;
      startLength = textareaValue.length;
      pending = "";
    },
    update: (eventText, textareaValue) => {
      pending = pendingFromTextarea(textareaValue) || eventText;
    },
    finish: () => {
      composing = false;
      pending = "";
      startLength = 0;
    },
    clear: (textarea) => {
      if (textarea && textarea.value.length >= startLength) {
        textarea.value = textarea.value.slice(0, startLength);
      }
      composing = false;
      pending = "";
      startLength = 0;
    },
    pendingText: (textareaValue) => pendingFromTextarea(textareaValue) || pending,
  };
}
