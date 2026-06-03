import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasAddon } from "@xterm/addon-canvas";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { ProfileKind } from "../../../shared/ipc";
import { createCodexTerminalDraftTracker } from "./terminal-codex-draft";
import { hasClipboardImage } from "./terminal-clipboard";
import { DEFAULT_TERMINAL_FONT_SIZE, resolveTerminalFontSize } from "./terminal-font-size";
import { createTerminalInputQueue, type QueuedTerminalInputSender } from "./terminal-input-queue";
import { isTerminalSoftNewlineKey, sendTerminalSoftNewline } from "./terminal-keyboard";
import { createTerminalOutputAckBatcher } from "./terminal-output-ack";
import { resolveTerminalRendererMode } from "./terminal-renderer";
import { fitAndReportTerminalSize, type TerminalSize } from "./terminal-size";

type TerminalPaneProps = {
  sessionId: string | null;
  profileKind: ProfileKind | null;
  onResize(cols: number, rows: number): void;
};

type TerminalContextMenu = {
  x: number;
  y: number;
  hasSelection: boolean;
};

export function TerminalPane({ sessionId, profileKind, onResize }: TerminalPaneProps): React.JSX.Element {
  const terminalSurfaceRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const reportedSizeRef = useRef<TerminalSize | null>(null);
  const sessionIdRef = useRef(sessionId);
  const profileKindRef = useRef(profileKind);
  const onResizeRef = useRef(onResize);
  const fontSizeRef = useRef(DEFAULT_TERMINAL_FONT_SIZE);
  const queuedTerminalInputRef = useRef<QueuedTerminalInputSender | null>(null);
  const codexDraftRef = useRef(createCodexTerminalDraftTracker());
  const [contextMenu, setContextMenu] = useState<TerminalContextMenu | null>(null);

  if (!queuedTerminalInputRef.current) {
    queuedTerminalInputRef.current = createTerminalInputQueue((request) => window.agenthub.terminalInput(request));
  }
  const sendQueuedTerminalInput = queuedTerminalInputRef.current;

  useEffect(() => {
    sessionIdRef.current = sessionId;
    reportedSizeRef.current = null;
    codexDraftRef.current.reset();
  }, [sessionId]);

  useEffect(() => {
    profileKindRef.current = profileKind;
    codexDraftRef.current.reset();
  }, [profileKind]);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  const copySelection = useCallback(async () => {
    const selection = terminalRef.current?.getSelection() ?? "";
    setContextMenu(null);
    if (!selection) {
      return;
    }
    await window.agenthub.writeClipboardText({ text: selection });
    terminalRef.current?.focus();
  }, []);

  const recordCodexTerminalInput = useCallback((data: string) => {
    if (profileKindRef.current === "codex") {
      codexDraftRef.current.recordUserInput(data);
    }
  }, []);

  const pasteClipboardImage = useCallback(async (): Promise<boolean> => {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) {
      return false;
    }
    const saved = await window.agenthub.saveClipboardImage({ sessionId: currentSessionId });
    if (!saved) {
      return false;
    }
    sendQueuedTerminalInput({
      sessionId: currentSessionId,
      data: saved.terminalText,
      source: "user",
    });
    recordCodexTerminalInput(saved.terminalText);
    terminalRef.current?.focus();
    return true;
  }, [recordCodexTerminalInput, sendQueuedTerminalInput]);

  const pasteClipboard = useCallback(async () => {
    const currentSessionId = sessionIdRef.current;
    setContextMenu(null);
    if (!currentSessionId) {
      return;
    }
    if (await pasteClipboardImage()) {
      return;
    }
    const text = await window.agenthub.readClipboardText();
    if (!text) {
      terminalRef.current?.focus();
      return;
    }
    sendQueuedTerminalInput({
      sessionId: currentSessionId,
      data: text,
      source: "user",
    });
    recordCodexTerminalInput(text);
    terminalRef.current?.focus();
  }, [pasteClipboardImage, recordCodexTerminalInput, sendQueuedTerminalInput]);

  const searchTerminal = useCallback(() => {
    setContextMenu(null);
    const query = window.prompt("查找终端内容");
    if (!query) {
      terminalRef.current?.focus();
      return;
    }
    searchAddonRef.current?.findNext(query, { incremental: false });
    terminalRef.current?.focus();
  }, []);

  useEffect(() => {
    const terminalSurface = terminalSurfaceRef.current;

    if (!terminalSurface) {
      return undefined;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
      fontSize: fontSizeRef.current,
      lineHeight: 1.18,
      scrollback: 5000,
      windowsMode: true,
      theme: {
        background: "#0c0f14",
        foreground: "#d8dee9",
        cursor: "#f8fafc",
        selectionBackground: "#315d9c",
        black: "#161b22",
        blue: "#6cb6ff",
        brightBlack: "#6e7681",
        brightBlue: "#79c0ff",
        brightCyan: "#56d4dd",
        brightGreen: "#7ee787",
        brightMagenta: "#d2a8ff",
        brightRed: "#ff7b72",
        brightWhite: "#ffffff",
        brightYellow: "#f2cc60",
        cyan: "#39c5cf",
        green: "#56d364",
        magenta: "#bc8cff",
        red: "#ff7b72",
        white: "#d8dee9",
        yellow: "#e3b341",
      },
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const ackBatcher = createTerminalOutputAckBatcher({
      sendAck: (request) => {
        void window.agenthub.terminalAck(request);
      },
    });
    const rendererDisposables: Array<{ dispose(): void }> = [];
    rendererDisposables.push(searchAddon);
    const enableCanvasRenderer = () => {
      try {
        const canvasAddon = new CanvasAddon();
        terminal.loadAddon(canvasAddon);
        rendererDisposables.push(canvasAddon);
      } catch {
        // xterm's DOM renderer remains active when accelerated renderers are unavailable.
      }
    };

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.open(terminalSurface);
    terminal.attachCustomKeyEventHandler((event) => {
      if (!isTerminalSoftNewlineKey(event)) {
        return true;
      }
      event.preventDefault();
      event.stopPropagation();
      void sendTerminalSoftNewline(
        sessionIdRef.current,
        profileKindRef.current,
        sendQueuedTerminalInput,
        codexDraftRef.current,
      );
      return false;
    });
    const rendererMode = resolveTerminalRendererMode(import.meta.env.VITE_AGENTHUB_TERMINAL_RENDERER);
    if (rendererMode === "webgl") {
      try {
        const webglAddon = new WebglAddon();
        terminal.loadAddon(webglAddon);
        rendererDisposables.push(webglAddon);
        const contextLossDisposable = webglAddon.onContextLoss(() => {
          contextLossDisposable.dispose();
          webglAddon.dispose();
          enableCanvasRenderer();
        });
        rendererDisposables.push(contextLossDisposable);
      } catch {
        enableCanvasRenderer();
      }
    } else {
      enableCanvasRenderer();
    }
    terminal.focus();

    const handlePaste = (event: ClipboardEvent) => {
      if (!hasClipboardImage(event.clipboardData)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void pasteClipboardImage();
    };
    terminalSurface.addEventListener("paste", handlePaste, { capture: true });

    const dataSubscription = terminal.onData((data) => {
      const currentSessionId = sessionIdRef.current;

      if (!currentSessionId) {
        return;
      }

      sendQueuedTerminalInput({
        sessionId: currentSessionId,
        data,
        source: "user",
      });
      recordCodexTerminalInput(data);
    });

    const removeTerminalDataListener = window.agenthub.onTerminalData((event) => {
      if (event.sessionId === sessionIdRef.current) {
        terminal.write(event.data, () => {
          ackBatcher.ackWrittenData(event.sessionId, event.data);
        });
      }
    });

    const fitAndReport = () => {
      reportedSizeRef.current = fitAndReportTerminalSize(
        sessionIdRef.current,
        terminal,
        fitAddon,
        onResizeRef.current,
        reportedSizeRef.current,
      );
    };

    const handleZoomKeyDown = (event: KeyboardEvent) => {
      const nextFontSize = resolveTerminalFontSize(fontSizeRef.current, event);

      if (nextFontSize === fontSizeRef.current) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      fontSizeRef.current = nextFontSize;
      terminal.options.fontSize = nextFontSize;
      fitAndReport();
      terminal.focus();
    };

    const resizeObserver = new ResizeObserver(fitAndReport);
    resizeObserver.observe(terminalSurface);
    terminalSurface.addEventListener("keydown", handleZoomKeyDown, { capture: true });
    fitAndReport();

    return () => {
      resizeObserver.disconnect();
      terminalSurface.removeEventListener("keydown", handleZoomKeyDown, { capture: true });
      terminalSurface.removeEventListener("paste", handlePaste, { capture: true });
      removeTerminalDataListener();
      dataSubscription.dispose();
      ackBatcher.dispose();
      for (const disposable of rendererDisposables) {
        disposable.dispose();
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [pasteClipboardImage, recordCodexTerminalInput, sendQueuedTerminalInput]);

  useEffect(() => {
    const hideContextMenu = () => setContextMenu(null);
    window.addEventListener("click", hideContextMenu);
    window.addEventListener("keydown", hideContextMenu);
    window.addEventListener("resize", hideContextMenu);
    return () => {
      window.removeEventListener("click", hideContextMenu);
      window.removeEventListener("keydown", hideContextMenu);
      window.removeEventListener("resize", hideContextMenu);
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;

    if (!sessionId || !terminal || !fitAddon) {
      return;
    }

    reportedSizeRef.current = fitAndReportTerminalSize(
      sessionId,
      terminal,
      fitAddon,
      onResizeRef.current,
      reportedSizeRef.current,
    );
  }, [sessionId]);

  return (
    <section
      className="terminal-pane"
      aria-label="Terminal"
      onContextMenu={(event) => {
        event.preventDefault();
        const terminal = terminalRef.current;
        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          hasSelection: Boolean(terminal?.hasSelection()),
        });
      }}
    >
      <div className="terminal-surface" ref={terminalSurfaceRef} />
      {contextMenu ? (
        <div
          className="terminal-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => void copySelection()} disabled={!contextMenu.hasSelection}>
            复制
          </button>
          <button type="button" role="menuitem" onClick={() => void pasteClipboard()} disabled={!sessionId}>
            粘贴
          </button>
          <button type="button" role="menuitem" onClick={searchTerminal}>
            查找
          </button>
        </div>
      ) : null}
    </section>
  );
}
