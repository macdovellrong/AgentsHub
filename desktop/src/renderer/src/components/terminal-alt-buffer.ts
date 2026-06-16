type DisposableLike = {
  dispose(): void;
};

type TerminalBufferLike = {
  active: unknown;
  alternate: unknown;
  onBufferChange(callback: () => void): DisposableLike;
};

type TerminalLike = {
  buffer: TerminalBufferLike;
};

export function createTerminalAltBufferTracker(terminal: TerminalLike, onEnterAlternateBuffer: () => void): DisposableLike {
  let wasInAlternateBuffer = isInAlternateBuffer(terminal);

  if (wasInAlternateBuffer) {
    onEnterAlternateBuffer();
  }

  const disposable = terminal.buffer.onBufferChange(() => {
    const isInAlternate = isInAlternateBuffer(terminal);
    if (isInAlternate && !wasInAlternateBuffer) {
      onEnterAlternateBuffer();
    }
    wasInAlternateBuffer = isInAlternate;
  });

  return {
    dispose: () => disposable.dispose(),
  };
}

function isInAlternateBuffer(terminal: TerminalLike): boolean {
  return terminal.buffer.active === terminal.buffer.alternate;
}
