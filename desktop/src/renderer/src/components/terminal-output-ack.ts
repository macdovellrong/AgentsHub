import type { TerminalAckRequest } from "../../../shared/ipc";

type TimerHandle = ReturnType<typeof setTimeout>;

type PendingAck = {
  byteLength: number;
  timer: TimerHandle | null;
};

type TerminalOutputAckBatcherOptions = {
  sendAck(request: TerminalAckRequest): void | Promise<void>;
  batchBytes?: number;
  flushMs?: number;
};

export const DEFAULT_TERMINAL_ACK_BATCH_BYTES = 5000;
export const DEFAULT_TERMINAL_ACK_FLUSH_MS = 50;

const encoder = new TextEncoder();

export function createTerminalOutputAckBatcher({
  sendAck,
  batchBytes = DEFAULT_TERMINAL_ACK_BATCH_BYTES,
  flushMs = DEFAULT_TERMINAL_ACK_FLUSH_MS,
}: TerminalOutputAckBatcherOptions): {
  ackWrittenData(sessionId: string, data: string): void;
  dispose(): void;
} {
  const pendingBySession = new Map<string, PendingAck>();

  const flush = (sessionId: string) => {
    const pending = pendingBySession.get(sessionId);
    if (!pending || pending.byteLength <= 0) {
      return;
    }
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    const byteLength = pending.byteLength;
    pending.byteLength = 0;
    try {
      void Promise.resolve(sendAck({ sessionId, byteLength })).catch(() => {
        // ACK is observational in this phase; terminal output must not break if delivery fails.
      });
    } catch {
      // A stale preload can miss terminalAck during development reloads.
    }
  };

  return {
    ackWrittenData(sessionId: string, data: string): void {
      const byteLength = encoder.encode(data).length;
      if (byteLength <= 0) {
        return;
      }
      const pending = pendingBySession.get(sessionId) ?? { byteLength: 0, timer: null };
      pending.byteLength += byteLength;
      pendingBySession.set(sessionId, pending);

      if (pending.byteLength >= batchBytes) {
        flush(sessionId);
        return;
      }

      pending.timer ??= setTimeout(() => flush(sessionId), flushMs);
    },

    dispose(): void {
      for (const pending of pendingBySession.values()) {
        if (pending.timer) {
          clearTimeout(pending.timer);
        }
      }
      pendingBySession.clear();
    },
  };
}
