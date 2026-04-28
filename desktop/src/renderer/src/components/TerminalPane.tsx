import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { fitAndReportTerminalSize } from "./terminal-size";

type TerminalPaneProps = {
  sessionId: string | null;
  onResize(cols: number, rows: number): void;
};

export function TerminalPane({ sessionId, onResize }: TerminalPaneProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef(sessionId);
  const onResizeRef = useRef(onResize);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
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
    terminal.open(container);
    fitAddon.fit();
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
      fitAndReportTerminalSize(sessionIdRef.current, terminal, fitAddon, onResizeRef.current);
    };

    const resizeObserver = new ResizeObserver(fitAndReport);
    resizeObserver.observe(container);
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
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;

    if (!sessionId || !terminal || !fitAddon) {
      return;
    }

    fitAndReportTerminalSize(sessionId, terminal, fitAddon, onResizeRef.current);
  }, [sessionId]);

  return <section className="terminal-pane" ref={containerRef} aria-label="Terminal" />;
}
