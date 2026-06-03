type TerminalInputRequest = {
  sessionId: string;
  data: string;
  source?: "user" | "program";
};

type TerminalInputSender = (request: TerminalInputRequest) => Promise<void>;

export type QueuedTerminalInputSender = (request: TerminalInputRequest) => void;

export function createTerminalInputQueue(sendTerminalInput: TerminalInputSender): QueuedTerminalInputSender {
  let tail = Promise.resolve();

  return (request) => {
    tail = tail
      .catch(() => undefined)
      .then(() => sendTerminalInput(request));
  };
}
