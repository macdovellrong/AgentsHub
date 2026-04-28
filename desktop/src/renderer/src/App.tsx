import { useCallback, useEffect, useState } from "react";
import type { SessionStatus, StartPowerShellResponse } from "../../shared/ipc";
import { TerminalPane } from "./components/TerminalPane";

type SessionState = StartPowerShellResponse | null;

export function App(): React.JSX.Element {
  const [workspacePath, setWorkspacePath] = useState("");
  const [session, setSession] = useState<SessionState>(null);
  const [status, setStatus] = useState<SessionStatus>("exited");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    window.agenthub
      .getDefaultWorkspace()
      .then((defaultWorkspace) => {
        if (isMounted) {
          setWorkspacePath(defaultWorkspace);
        }
      })
      .catch((reason: unknown) => {
        if (isMounted) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    return window.agenthub.onSessionExit((event) => {
      setSession((currentSession) => {
        if (!currentSession || currentSession.sessionId !== event.sessionId) {
          return currentSession;
        }
        setStatus("exited");
        return currentSession;
      });
    });
  }, []);

  useEffect(() => {
    return window.agenthub.onSessionError((event) => {
      setSession((currentSession) => {
        if (event.sessionId && currentSession?.sessionId !== event.sessionId) {
          return currentSession;
        }
        setStatus("error");
        setError(event.message);
        return currentSession;
      });
    });
  }, []);

  const startPowerShell = useCallback(async () => {
    setError(null);
    setStatus("starting");

    try {
      const nextSession = await window.agenthub.startPowerShell({
        workspacePath: workspacePath || undefined,
        cols: 120,
        rows: 36,
      });
      setSession(nextSession);
      setWorkspacePath(nextSession.workspacePath);
      setStatus("online");
    } catch (reason) {
      setStatus("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [workspacePath]);

  const stopSession = useCallback(async () => {
    if (!session) {
      return;
    }

    setError(null);

    try {
      await window.agenthub.stopSession(session.sessionId);
      setStatus("exited");
    } catch (reason) {
      setStatus("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [session]);

  const resizeTerminal = useCallback(
    (cols: number, rows: number) => {
      if (!session) {
        return;
      }

      void window.agenthub.terminalResize({
        sessionId: session.sessionId,
        cols,
        rows,
      });
    },
    [session],
  );

  const isOnline = status === "online" || status === "starting";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>AgentHub</h1>
          <p>Electron terminal smoke</p>
        </div>
        <div className="actions">
          <span className={`status-pill status-${status}`}>{status}</span>
          <button type="button" onClick={startPowerShell} disabled={isOnline}>
            Start PowerShell
          </button>
          <button type="button" onClick={stopSession} disabled={!session || status !== "online"}>
            Stop
          </button>
        </div>
      </header>

      <section className="workspace-row" aria-label="Workspace">
        <span>Workspace</span>
        <code>{workspacePath || "Loading..."}</code>
      </section>

      {error ? <section className="error-banner">{error}</section> : null}

      <TerminalPane sessionId={session?.sessionId ?? null} onResize={resizeTerminal} />
    </main>
  );
}
