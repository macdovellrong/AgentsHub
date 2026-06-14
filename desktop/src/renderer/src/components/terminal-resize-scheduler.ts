type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

export type TerminalResizeScheduler = {
  schedule(): void;
  dispose(): void;
};

export function createTerminalResizeScheduler(
  fitAndReport: () => void,
  requestFrame: RequestFrame = window.requestAnimationFrame.bind(window),
  cancelFrame: CancelFrame = window.cancelAnimationFrame.bind(window),
): TerminalResizeScheduler {
  let disposed = false;
  let pendingFrame: number | null = null;

  return {
    schedule: () => {
      if (disposed || pendingFrame !== null) {
        return;
      }
      pendingFrame = requestFrame(() => {
        pendingFrame = null;
        if (!disposed) {
          fitAndReport();
        }
      });
    },
    dispose: () => {
      disposed = true;
      if (pendingFrame !== null) {
        cancelFrame(pendingFrame);
        pendingFrame = null;
      }
    },
  };
}
