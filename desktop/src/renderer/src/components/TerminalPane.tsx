import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { fitAndReportTerminalSize, type TerminalSize } from "./terminal-size";

type TerminalPaneProps = {
  sessionId: string | null;
  onResize(cols: number, rows: number): void;
};

type TerminalContextMenu = {
  x: number;
  y: number;
  hasSelection: boolean;
};

export function TerminalPane({ sessionId, onResize }: TerminalPaneProps): React.JSX.Element {
  const terminalSurfaceRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const reportedSizeRef = useRef<TerminalSize | null>(null);
  const sessionIdRef = useRef(sessionId);
  const onResizeRef = useRef(onResize);
  const [contextMenu, setContextMenu] = useState<TerminalContextMenu | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    reportedSizeRef.current = null;
  }, [sessionId]);

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

  const pasteClipboard = useCallback(async () => {
    const currentSessionId = sessionIdRef.current;
    setContextMenu(null);
    if (!currentSessionId) {
      return;
    }
    const text = await window.agenthub.readClipboardText();
    if (!text) {
      terminalRef.current?.focus();
      return;
    }
    await window.agenthub.terminalInput({
      sessionId: currentSessionId,
      data: text,
    });
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
      fontSize: 13,
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

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.open(terminalSurface);
    terminal.focus();

    const dataSubscription = terminal.onData((data) => {
      const currentSessionId = sessionIdRef.current;

      if (!currentSessionId) {
        return;
      }

      void window.agenthub.terminalInput({
        sessionId: currentSessionId,
        data,
      });
    });

    const removeTerminalDataListener = window.agenthub.onTerminalData((event) => {
      if (event.sessionId === sessionIdRef.current) {
        terminal.write(event.data);
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

    const resizeObserver = new ResizeObserver(fitAndReport);
    resizeObserver.observe(terminalSurface);
    fitAndReport();

    return () => {
      resizeObserver.disconnect();
      removeTerminalDataListener();
      dataSubscription.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

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
        </div>
      ) : null}
    </section>
  );
}
