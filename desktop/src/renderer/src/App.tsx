import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentForwardDto,
  AgentHubEventDto,
  AgentProfileDto,
  AgentTaskDto,
  ForwardStatus,
  RunHistoryDto,
  SessionStatus,
  StartPowerShellResponse,
  TaskStatus,
} from "../../shared/ipc";
import {
  buildProfileSavePayload,
  buildRoutedTerminalMessage,
  findOnlineSessionForProfile,
  findOnlineSessionForTarget,
  pickSelectedSessionId,
  profileToFields,
  type ProfileEditorFields,
} from "./dashboard-helpers";
import { TerminalPane } from "./components/TerminalPane";

const TASK_STATUSES: TaskStatus[] = ["pending", "running", "review", "done", "failed"];
const RUN_STATUSES: Array<RunHistoryDto["status"] | "all"> = ["all", "running", "exited"];

const emptyEditorFields: ProfileEditorFields = {
  name: "",
  command: "",
  argsText: "",
  aliasesText: "",
  rolePrompt: "",
  useWorkspaceWriteLock: false,
};

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function statusClass(status: SessionStatus | RunHistoryDto["status"] | TaskStatus | ForwardStatus): string {
  return `status-${status}`;
}

function describeEvent(event: AgentHubEventDto): string {
  if (event.message) {
    return event.message;
  }
  if (event.error) {
    return event.error;
  }
  if (event.type === "session_started") {
    return `${event.profileName ?? event.profileId ?? "Session"} started`;
  }
  if (event.type === "session_exited") {
    return `${event.profileName ?? event.profileId ?? "Session"} exited`;
  }
  return event.type.replace(/_/g, " ");
}

export function App(): React.JSX.Element {
  const [workspacePath, setWorkspacePath] = useState("");
  const [profiles, setProfiles] = useState<AgentProfileDto[]>([]);
  const [sessions, setSessions] = useState<StartPowerShellResponse[]>([]);
  const [events, setEvents] = useState<AgentHubEventDto[]>([]);
  const [runs, setRuns] = useState<RunHistoryDto[]>([]);
  const [tasks, setTasks] = useState<AgentTaskDto[]>([]);
  const [forwards, setForwards] = useState<AgentForwardDto[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [editorFields, setEditorFields] = useState<ProfileEditorFields>(emptyEditorFields);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [startingProfileIds, setStartingProfileIds] = useState<Set<string>>(() => new Set());
  const [inputText, setInputText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [runProfileFilter, setRunProfileFilter] = useState("all");
  const [runStatusFilter, setRunStatusFilter] = useState<(typeof RUN_STATUSES)[number]>("all");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [rawLog, setRawLog] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [orchestrationGoal, setOrchestrationGoal] = useState("");
  const [forwardSourceProfileId, setForwardSourceProfileId] = useState("");
  const [forwardTargetProfileId, setForwardTargetProfileId] = useState("");
  const [forwardMessage, setForwardMessage] = useState("");

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? null,
    [profiles, selectedProfileId],
  );
  const activeSessions = useMemo(
    () => sessions.filter((session) => session.status === "online" || session.status === "starting"),
    [sessions],
  );
  const selectedSession = activeSessions.find((session) => session.sessionId === selectedSessionId) ?? null;
  const filteredRuns = runs.filter((run) => {
    const profileMatches = runProfileFilter === "all" || run.profileId === runProfileFilter;
    const statusMatches = runStatusFilter === "all" || run.status === runStatusFilter;
    return profileMatches && statusMatches;
  });
  const profileNameById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile.name])),
    [profiles],
  );

  const refreshProfilesAndSessions = useCallback(async () => {
    const [nextProfiles, nextSessions] = await Promise.all([
      window.agenthub.listProfiles(),
      window.agenthub.listSessions(),
    ]);
    setProfiles(nextProfiles);
    setSessions(nextSessions);
    setSelectedProfileId((current) => current ?? nextProfiles[0]?.id ?? null);
    setSelectedSessionId((current) => pickSelectedSessionId(current, nextSessions));
  }, []);

  const refreshWorkspaceData = useCallback(async (workspace = workspacePath) => {
    const request = workspace ? { workspacePath: workspace } : {};
    const [nextEvents, nextRuns, nextTasks, nextForwards] = await Promise.all([
      window.agenthub.listEvents(request),
      window.agenthub.listRuns(request),
      window.agenthub.listTasks(request),
      window.agenthub.listForwards(request),
    ]);
    setEvents(nextEvents);
    setRuns(nextRuns);
    setTasks(nextTasks);
    setForwards(nextForwards);
  }, [workspacePath]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshProfilesAndSessions(), refreshWorkspaceData()]);
  }, [refreshProfilesAndSessions, refreshWorkspaceData]);

  const openWorkspace = useCallback(async () => {
    setError(null);
    try {
      const nextWorkspace = await window.agenthub.selectWorkspace({ workspacePath: workspacePath || undefined });
      setWorkspacePath(nextWorkspace);
      setSelectedRunId(null);
      setRawLog("");
      await refreshWorkspaceData(nextWorkspace);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [refreshWorkspaceData, workspacePath]);

  useEffect(() => {
    let isMounted = true;

    window.agenthub
      .getDefaultWorkspace()
      .then(async (defaultWorkspace) => {
        if (!isMounted) {
          return;
        }
        setWorkspacePath(defaultWorkspace);
        await Promise.all([refreshProfilesAndSessions(), refreshWorkspaceData(defaultWorkspace)]);
      })
      .catch((reason: unknown) => {
        if (isMounted) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      isMounted = false;
    };
  }, [refreshProfilesAndSessions, refreshWorkspaceData]);

  useEffect(() => {
    if (selectedProfile) {
      setEditorFields(profileToFields(selectedProfile));
    } else {
      setEditorFields(emptyEditorFields);
    }
  }, [selectedProfile]);

  useEffect(() => {
    if (profiles.length === 0) {
      return;
    }
    setForwardSourceProfileId((current) => current || (profiles.find((profile) => profile.kind === "claude")?.id ?? ""));
    setForwardTargetProfileId(
      (current) => current || (profiles.find((profile) => profile.kind === "codex")?.id ?? profiles[0].id),
    );
  }, [profiles]);

  useEffect(() => {
    return window.agenthub.onSessionExit((event) => {
      setSessions((current) =>
        current.map((session) =>
          session.sessionId === event.sessionId ? { ...session, status: "exited" as const } : session,
        ),
      );
      setSelectedSessionId((current) =>
        current === event.sessionId ? pickSelectedSessionId(null, activeSessions.filter((s) => s.sessionId !== event.sessionId)) : current,
      );
      void refreshWorkspaceData();
    });
  }, [activeSessions, refreshWorkspaceData]);

  useEffect(() => {
    return window.agenthub.onSessionError((event) => {
      setError(event.message);
      if (event.sessionId) {
        setSessions((current) =>
          current.map((session) =>
            session.sessionId === event.sessionId ? { ...session, status: "error" as const } : session,
          ),
        );
      }
      void refreshWorkspaceData();
    });
  }, [refreshWorkspaceData]);

  const startProfile = useCallback(
    async (profileId: string) => {
      setError(null);
      setStartingProfileIds((current) => new Set(current).add(profileId));
      try {
        const session = await window.agenthub.startProfile({
          profileId,
          workspacePath: workspacePath || undefined,
          cols: 120,
          rows: 32,
        });
        setWorkspacePath(session.workspacePath);
        setSessions((current) => [session, ...current.filter((item) => item.sessionId !== session.sessionId)]);
        setSelectedSessionId(session.sessionId);
        await refreshWorkspaceData(session.workspacePath);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setStartingProfileIds((current) => {
          const next = new Set(current);
          next.delete(profileId);
          return next;
        });
      }
    },
    [refreshWorkspaceData, workspacePath],
  );

  const stopSession = useCallback(
    async (sessionId: string) => {
      setError(null);
      try {
        await window.agenthub.stopSession(sessionId);
        setSessions((current) =>
          current.map((session) => (session.sessionId === sessionId ? { ...session, status: "exited" as const } : session)),
        );
        await refreshWorkspaceData();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [refreshWorkspaceData],
  );

  const resizeTerminal = useCallback((sessionId: string, cols: number, rows: number) => {
    void window.agenthub.terminalResize({ sessionId, cols, rows });
  }, []);

  const saveSelectedProfile = useCallback(async () => {
    if (!selectedProfile) {
      return;
    }
    setError(null);
    try {
      const patch = buildProfileSavePayload(selectedProfile, editorFields);
      const updated = await window.agenthub.updateProfile({ id: selectedProfile.id, patch });
      setProfiles((current) => current.map((profile) => (profile.id === updated.id ? updated : profile)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [editorFields, selectedProfile]);

  const createCustomProfile = useCallback(async () => {
    setError(null);
    try {
      const created = await window.agenthub.createProfile({
        name: "Custom Agent",
        kind: "custom",
        command: "powershell.exe",
        args: [],
        aliases: [],
        rolePrompt: "",
        env: {},
        defaultCwd: null,
        useWorkspaceWriteLock: false,
      });
      setProfiles((current) => [...current, created]);
      setSelectedProfileId(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  const duplicateSelectedProfile = useCallback(async () => {
    if (!selectedProfile) {
      return;
    }
    setError(null);
    try {
      const duplicate = await window.agenthub.duplicateProfile({ id: selectedProfile.id });
      setProfiles((current) => [...current, duplicate]);
      setSelectedProfileId(duplicate.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [selectedProfile]);

  const deleteSelectedProfile = useCallback(async () => {
    if (!selectedProfile) {
      return;
    }
    setError(null);
    try {
      await window.agenthub.deleteProfile(selectedProfile.id);
      setProfiles((current) => current.filter((profile) => profile.id !== selectedProfile.id));
      setSelectedProfileId((current) => (current === selectedProfile.id ? null : current));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [selectedProfile]);

  const appendErrorEvent = useCallback(
    async (message: string) => {
      await window.agenthub.appendEvent({
        workspacePath: workspacePath || undefined,
        type: "error",
        message,
        error: message,
      });
      await refreshWorkspaceData();
    },
    [refreshWorkspaceData, workspacePath],
  );

  const routeMessage = useCallback(async () => {
    const text = inputText.trim();
    if (!text) {
      return;
    }

    setError(null);
    setInputText("");

    try {
      const routed = await window.agenthub.routeInput({ workspacePath: workspacePath || undefined, text });
      await refreshWorkspaceData();

      if (!routed.targetProfileId) {
        await appendErrorEvent("Add an @profile target such as @codex before sending.");
        return;
      }

      const targetSession =
        findOnlineSessionForProfile(routed.targetProfileId, sessions, workspacePath) ??
        findOnlineSessionForTarget(text, sessions, profiles, workspacePath);

      if (!targetSession) {
        const profile = profiles.find((candidate) => candidate.id === routed.targetProfileId);
        await appendErrorEvent(`${profile?.name ?? routed.targetProfileId} is not online. Start the profile before routing input.`);
        return;
      }

      await window.agenthub.terminalInput({
        sessionId: targetSession.sessionId,
        data: `${buildRoutedTerminalMessage(
          profiles.find((profile) => profile.id === targetSession.profileId),
          routed.message,
        )}\r`,
      });
      setSelectedSessionId(targetSession.sessionId);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      await appendErrorEvent(message);
    }
  }, [appendErrorEvent, inputText, profiles, refreshWorkspaceData, sessions, workspacePath]);

  const loadRunRawLog = useCallback(
    async (runId: string) => {
      setSelectedRunId(runId);
      setRawLog("Loading raw log...");
      try {
        const log = await window.agenthub.readRunRawLog({ workspacePath: workspacePath || undefined, runId });
        setRawLog(log || "(empty raw log)");
      } catch (reason) {
        setRawLog(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [workspacePath],
  );

  const createTask = useCallback(async () => {
    const title = newTaskTitle.trim();
    if (!title) {
      return;
    }
    setError(null);
    try {
      await window.agenthub.createTask({
        workspacePath: workspacePath || undefined,
        title,
        description: newTaskDescription.trim(),
        status: "pending",
        profileId: selectedProfile?.id ?? null,
        runId: selectedRunId,
      });
      setNewTaskTitle("");
      setNewTaskDescription("");
      await refreshWorkspaceData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [newTaskDescription, newTaskTitle, refreshWorkspaceData, selectedProfile, selectedRunId, workspacePath]);

  const updateTaskStatus = useCallback(
    async (task: AgentTaskDto, status: TaskStatus) => {
      try {
        await window.agenthub.updateTask({
          workspacePath: workspacePath || undefined,
          taskId: task.id,
          patch: { status },
        });
        await refreshWorkspaceData();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [refreshWorkspaceData, workspacePath],
  );

  const startOrchestration = useCallback(async () => {
    const goal = orchestrationGoal.trim();
    if (!goal) {
      return;
    }
    setError(null);
    try {
      await window.agenthub.startOrchestration({
        workspacePath: workspacePath || undefined,
        goal,
        plannerProfileId: profiles.find((profile) => profile.kind === "claude")?.id,
        implementerProfileId: profiles.find((profile) => profile.kind === "codex")?.id,
        reviewerProfileId: profiles.find((profile) => profile.kind === "gemini")?.id,
      });
      setOrchestrationGoal("");
      await refreshWorkspaceData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [orchestrationGoal, profiles, refreshWorkspaceData, workspacePath]);

  const createForward = useCallback(async () => {
    const message = forwardMessage.trim();
    const targetProfileId = forwardTargetProfileId || selectedProfile?.id || profiles[0]?.id;
    if (!message || !targetProfileId) {
      return;
    }
    setError(null);
    try {
      await window.agenthub.createForward({
        workspacePath: workspacePath || undefined,
        sourceProfileId: forwardSourceProfileId || null,
        targetProfileId,
        message,
      });
      setForwardMessage("");
      await refreshWorkspaceData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [
    forwardMessage,
    forwardSourceProfileId,
    forwardTargetProfileId,
    profiles,
    refreshWorkspaceData,
    selectedProfile,
    workspacePath,
  ]);

  const sendForward = useCallback(
    async (forwardId: string) => {
      setError(null);
      try {
        const updated = await window.agenthub.sendForward({
          workspacePath: workspacePath || undefined,
          forwardId,
        });
        if (updated.sessionId) {
          setSelectedSessionId(updated.sessionId);
        }
        await refreshWorkspaceData();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [refreshWorkspaceData, workspacePath],
  );

  const pauseForward = useCallback(
    async (forwardId: string) => {
      setError(null);
      try {
        await window.agenthub.pauseForward({
          workspacePath: workspacePath || undefined,
          forwardId,
        });
        await refreshWorkspaceData();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [refreshWorkspaceData, workspacePath],
  );

  const stopForward = useCallback(
    async (forwardId: string) => {
      setError(null);
      try {
        await window.agenthub.stopForward({
          workspacePath: workspacePath || undefined,
          forwardId,
        });
        await refreshWorkspaceData();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [refreshWorkspaceData, workspacePath],
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <h1>AgentHub</h1>
          <p>{workspacePath || "Loading workspace..."}</p>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={() => void openWorkspace()}>
            Open Workspace
          </button>
          <button type="button" onClick={() => void refreshAll()}>
            Refresh
          </button>
          <span className="summary-pill">{activeSessions.length} online</span>
        </div>
      </header>

      {error ? <section className="error-banner">{error}</section> : null}

      <section className="dashboard-grid">
        <aside className="sidebar panel">
          <div className="panel-header">
            <h2>Profiles</h2>
            <button type="button" onClick={() => void createCustomProfile()}>
              New
            </button>
          </div>

          <div className="profile-list">
            {profiles.map((profile) => {
              const onlineSessions = sessions.filter(
                (session) => session.profileId === profile.id && session.status === "online",
              );
              const isStarting = startingProfileIds.has(profile.id);
              return (
                <article
                  className={`profile-row ${selectedProfile?.id === profile.id ? "is-selected" : ""}`}
                  key={profile.id}
                  onClick={() => setSelectedProfileId(profile.id)}
                >
                  <div>
                    <strong>{profile.name}</strong>
                    <span>{profile.kind}</span>
                  </div>
                  <div className="profile-actions">
                    <span className={`status-pill ${onlineSessions.length > 0 ? "status-online" : "status-exited"}`}>
                      {isStarting ? "starting" : onlineSessions.length > 0 ? "online" : "offline"}
                    </span>
                    <button type="button" onClick={() => void startProfile(profile.id)} disabled={isStarting}>
                      Start
                    </button>
                    {onlineSessions.map((session) => (
                      <button type="button" key={session.sessionId} onClick={() => void stopSession(session.sessionId)}>
                        Stop
                      </button>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>

          <section className="editor-block">
            <div className="panel-header">
              <h2>Profile Editor</h2>
              <div className="button-row">
                <button type="button" onClick={() => void duplicateSelectedProfile()} disabled={!selectedProfile}>
                  Duplicate
                </button>
                <button type="button" onClick={() => void deleteSelectedProfile()} disabled={!selectedProfile}>
                  Delete
                </button>
              </div>
            </div>
            <label>
              Name
              <input
                value={editorFields.name}
                onChange={(event) => setEditorFields((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label>
              Command
              <input
                value={editorFields.command}
                onChange={(event) => setEditorFields((current) => ({ ...current, command: event.target.value }))}
              />
            </label>
            <label>
              Args
              <textarea
                rows={3}
                value={editorFields.argsText}
                onChange={(event) => setEditorFields((current) => ({ ...current, argsText: event.target.value }))}
              />
            </label>
            <label>
              Aliases
              <input
                value={editorFields.aliasesText}
                onChange={(event) => setEditorFields((current) => ({ ...current, aliasesText: event.target.value }))}
              />
            </label>
            <label>
              Role Prompt
              <textarea
                rows={5}
                value={editorFields.rolePrompt}
                onChange={(event) => setEditorFields((current) => ({ ...current, rolePrompt: event.target.value }))}
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={editorFields.useWorkspaceWriteLock}
                onChange={(event) =>
                  setEditorFields((current) => ({ ...current, useWorkspaceWriteLock: event.target.checked }))
                }
              />
              Workspace write lock
            </label>
            <button type="button" onClick={() => void saveSelectedProfile()} disabled={!selectedProfile}>
              Save Profile
            </button>
          </section>
        </aside>

        <section className="center-stack">
          <section className="timeline panel">
            <div className="panel-header">
              <h2>Conversation</h2>
              <span>{events.length} events</span>
            </div>
            <div className="event-list">
              {events.length === 0 ? <p className="empty-state">No events for this workspace.</p> : null}
              {events.map((event) => (
                <article className={`event-card event-${event.type}`} key={event.id}>
                  <div className="event-meta">
                    <span>{formatTime(event.timestamp)}</span>
                    <strong>{event.type.replace(/_/g, " ")}</strong>
                    {event.profileName ?? event.profileId ? <span>{event.profileName ?? event.profileId}</span> : null}
                  </div>
                  <p>{describeEvent(event)}</p>
                </article>
              ))}
            </div>
            <div className="input-row">
              <input
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void routeMessage();
                  }
                }}
                placeholder="@codex implement the next task"
              />
              <button type="button" onClick={() => void routeMessage()}>
                Send
              </button>
            </div>
          </section>

          <section className="orchestration panel">
            <div className="panel-header">
              <h2>Controlled Orchestration</h2>
              <span>manual trigger</span>
            </div>
            <div className="input-row">
              <input
                value={orchestrationGoal}
                onChange={(event) => setOrchestrationGoal(event.target.value)}
                placeholder="Goal for planner -> implementer -> reviewer"
              />
              <button type="button" onClick={() => void startOrchestration()}>
                Start
              </button>
            </div>
          </section>

          <section className="forwarding panel">
            <div className="panel-header">
              <h2>Forwarding</h2>
              <span>{forwards.length} forwards</span>
            </div>
            <div className="forward-create">
              <select value={forwardSourceProfileId} onChange={(event) => setForwardSourceProfileId(event.target.value)}>
                <option value="">source</option>
                {profiles.map((profile) => (
                  <option value={profile.id} key={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <select value={forwardTargetProfileId} onChange={(event) => setForwardTargetProfileId(event.target.value)}>
                {profiles.map((profile) => (
                  <option value={profile.id} key={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <input
                value={forwardMessage}
                onChange={(event) => setForwardMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void createForward();
                  }
                }}
                placeholder="Forward result or review request"
              />
              <button type="button" onClick={() => void createForward()}>
                Queue
              </button>
            </div>
            <div className="forward-list">
              {forwards.length === 0 ? <p className="empty-state">No forwards for this workspace.</p> : null}
              {forwards.map((forward) => (
                <article className="forward-card" key={forward.id}>
                  <div className="forward-meta">
                    <strong>
                      {forward.sourceProfileId ? profileNameById.get(forward.sourceProfileId) ?? forward.sourceProfileId : "Manual"}
                      {" -> "}
                      {profileNameById.get(forward.targetProfileId) ?? forward.targetProfileId}
                    </strong>
                    <span className={`status-pill ${statusClass(forward.status)}`}>{forward.status}</span>
                  </div>
                  <p>{forward.message}</p>
                  {forward.lastError ? <p className="forward-error">{forward.lastError}</p> : null}
                  <div className="button-row">
                    <button
                      type="button"
                      onClick={() => void sendForward(forward.id)}
                      disabled={forward.status === "sent" || forward.status === "stopped"}
                    >
                      Send
                    </button>
                    <button
                      type="button"
                      onClick={() => void pauseForward(forward.id)}
                      disabled={forward.status === "sent" || forward.status === "paused" || forward.status === "stopped"}
                    >
                      Pause
                    </button>
                    <button type="button" onClick={() => void stopForward(forward.id)} disabled={forward.status === "stopped"}>
                      Stop
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="tasks panel">
            <div className="panel-header">
              <h2>Tasks</h2>
              <span>{tasks.length} total</span>
            </div>
            <div className="task-create">
              <input
                value={newTaskTitle}
                onChange={(event) => setNewTaskTitle(event.target.value)}
                placeholder="Task title"
              />
              <input
                value={newTaskDescription}
                onChange={(event) => setNewTaskDescription(event.target.value)}
                placeholder="Description"
              />
              <button type="button" onClick={() => void createTask()}>
                Create
              </button>
            </div>
            <div className="task-columns">
              {TASK_STATUSES.map((status) => (
                <section className="task-column" key={status}>
                  <h3>{status}</h3>
                  {tasks
                    .filter((task) => task.status === status)
                    .map((task) => (
                      <article className="task-card" key={task.id}>
                        <strong>{task.title}</strong>
                        {task.description ? <p>{task.description}</p> : null}
                        <select value={task.status} onChange={(event) => void updateTaskStatus(task, event.target.value as TaskStatus)}>
                          {TASK_STATUSES.map((option) => (
                            <option value={option} key={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </article>
                    ))}
                </section>
              ))}
            </div>
          </section>
        </section>

        <aside className="right-stack">
          <section className="terminal-dock panel">
            <div className="panel-header">
              <h2>Terminals</h2>
              {selectedSession ? (
                <button type="button" onClick={() => void stopSession(selectedSession.sessionId)}>
                  Stop Selected
                </button>
              ) : null}
            </div>
            <div className="session-tabs">
              {activeSessions.map((session) => (
                <button
                  type="button"
                  className={selectedSessionId === session.sessionId ? "is-selected" : ""}
                  key={session.sessionId}
                  onClick={() => setSelectedSessionId(session.sessionId)}
                >
                  {session.profileName}
                </button>
              ))}
            </div>
            <div className="terminal-host">
              {activeSessions.length === 0 ? <p className="empty-state">Start a profile to open a terminal.</p> : null}
              {activeSessions.map((session) => (
                <div
                  className={`terminal-wrap ${selectedSessionId === session.sessionId ? "is-visible" : ""}`}
                  key={session.sessionId}
                >
                  <TerminalPane
                    sessionId={session.sessionId}
                    onResize={(cols, rows) => resizeTerminal(session.sessionId, cols, rows)}
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="runs panel">
            <div className="panel-header">
              <h2>Runs</h2>
              <span>{filteredRuns.length}</span>
            </div>
            <div className="filter-row">
              <select value={runProfileFilter} onChange={(event) => setRunProfileFilter(event.target.value)}>
                <option value="all">all profiles</option>
                {profiles.map((profile) => (
                  <option value={profile.id} key={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <select
                value={runStatusFilter}
                onChange={(event) => setRunStatusFilter(event.target.value as (typeof RUN_STATUSES)[number])}
              >
                {RUN_STATUSES.map((status) => (
                  <option value={status} key={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="run-list">
              {filteredRuns.map((run) => (
                <button
                  type="button"
                  className={`run-row ${selectedRunId === run.runId ? "is-selected" : ""}`}
                  key={run.runId}
                  onClick={() => void loadRunRawLog(run.runId)}
                >
                  <span>{run.profileId}</span>
                  <span className={`status-pill ${statusClass(run.status)}`}>{run.status}</span>
                </button>
              ))}
            </div>
            <pre className="raw-log">{rawLog || "Select a run to inspect raw.log."}</pre>
          </section>
        </aside>
      </section>
    </main>
  );
}
