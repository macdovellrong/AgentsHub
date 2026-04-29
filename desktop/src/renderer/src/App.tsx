import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type {
  AgentHubEventDto,
  AgentProfileDto,
  AgentTaskDto,
  RunHistoryDto,
  SessionStatus,
  StartPowerShellResponse,
  TaskStatus,
  WorkspaceDto,
} from "../../shared/ipc";
import {
  appendTerminalPreview,
  applyMentionSelection,
  buildQuotedForwardMessage,
  buildProfileSavePayload,
  buildRoutedTerminalMessage,
  countOnlineSessionsForWorkspace,
  filterSessionsForWorkspace,
  findMentionQuery,
  getMentionCandidates,
  findOnlineSessionForProfile,
  findOnlineSessionForTarget,
  pickSelectedSessionId,
  type MentionQuery,
  profileToFields,
  type QuotedForwardMessage,
  type ProfileEditorFields,
} from "./dashboard-helpers";
import { TerminalPane } from "./components/TerminalPane";
import { UI_TEXT, formatEventTypeLabel, formatStatusLabel } from "./ui-text";

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

function statusClass(status: SessionStatus | RunHistoryDto["status"] | TaskStatus): string {
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
    return `${event.profileName ?? event.profileId ?? "Session"} ${UI_TEXT.summaries.started}`;
  }
  if (event.type === "session_exited") {
    return `${event.profileName ?? event.profileId ?? "Session"} ${UI_TEXT.summaries.exited}`;
  }
  return event.type.replace(/_/g, " ");
}

function chatMessageClass(event: AgentHubEventDto): string {
  if (event.type === "user_message") {
    return "chat-message-user";
  }
  if (event.type === "error") {
    return "chat-message-error";
  }
  if (event.type === "agent_output" || event.type === "agent_forward") {
    return "chat-message-agent";
  }
  return "chat-message-system";
}

function chatSenderLabel(event: AgentHubEventDto): string {
  if (event.type === "user_message") {
    return "你";
  }
  if (event.type === "error") {
    return "系统";
  }
  return event.profileName ?? event.profileId ?? formatEventTypeLabel(event.type);
}

type QuotedChatMessage = QuotedForwardMessage & {
  sourceProfileId: string | null;
};

export function App(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const eventListRef = useRef<HTMLDivElement | null>(null);
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [profiles, setProfiles] = useState<AgentProfileDto[]>([]);
  const [sessions, setSessions] = useState<StartPowerShellResponse[]>([]);
  const [events, setEvents] = useState<AgentHubEventDto[]>([]);
  const [runs, setRuns] = useState<RunHistoryDto[]>([]);
  const [tasks, setTasks] = useState<AgentTaskDto[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [editorFields, setEditorFields] = useState<ProfileEditorFields>(emptyEditorFields);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [startingProfileIds, setStartingProfileIds] = useState<Set<string>>(() => new Set());
  const [inputText, setInputText] = useState("");
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [runProfileFilter, setRunProfileFilter] = useState("all");
  const [runStatusFilter, setRunStatusFilter] = useState<(typeof RUN_STATUSES)[number]>("all");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [rawLog, setRawLog] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [orchestrationGoal, setOrchestrationGoal] = useState("");
  const [terminalPreviews, setTerminalPreviews] = useState<Record<string, string>>({});
  const [quotedMessage, setQuotedMessage] = useState<QuotedChatMessage | null>(null);
  const [isLogDrawerOpen, setIsLogDrawerOpen] = useState(false);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? null,
    [profiles, selectedProfileId],
  );
  const activeSessions = useMemo(() => filterSessionsForWorkspace(sessions, workspacePath), [sessions, workspacePath]);
  const selectedSession = activeSessions.find((session) => session.sessionId === selectedSessionId) ?? null;
  const selectedSessionPreview = selectedSession ? (terminalPreviews[selectedSession.sessionId] ?? "").trim() : "";
  const filteredRuns = runs.filter((run) => {
    const profileMatches = runProfileFilter === "all" || run.profileId === runProfileFilter;
    const statusMatches = runStatusFilter === "all" || run.status === runStatusFilter;
    return profileMatches && statusMatches;
  });
  const mentionCandidates = useMemo(
    () => (mentionQuery ? getMentionCandidates(mentionQuery.query, profiles).slice(0, 8) : []),
    [mentionQuery, profiles],
  );

  const refreshMentionQuery = useCallback((text: string, cursor: number | null) => {
    if (cursor === null) {
      setMentionQuery(null);
      return;
    }
    const nextMention = findMentionQuery(text, cursor);
    setMentionQuery(nextMention);
    setSelectedMentionIndex(0);
  }, []);

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

  const refreshWorkspaces = useCallback(async () => {
    const nextWorkspaces = await window.agenthub.listWorkspaces();
    setWorkspaces(nextWorkspaces);
  }, []);

  const refreshWorkspaceData = useCallback(async (workspace = workspacePath) => {
    const request = workspace ? { workspacePath: workspace } : {};
    const [nextEvents, nextRuns, nextTasks] = await Promise.all([
      window.agenthub.listEvents(request),
      window.agenthub.listRuns(request),
      window.agenthub.listTasks(request),
    ]);
    setEvents(nextEvents);
    setRuns(nextRuns);
    setTasks(nextTasks);
  }, [workspacePath]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshProfilesAndSessions(), refreshWorkspaceData(), refreshWorkspaces()]);
  }, [refreshProfilesAndSessions, refreshWorkspaceData, refreshWorkspaces]);

  const openWorkspace = useCallback(async () => {
    setError(null);
    try {
      const nextWorkspace = await window.agenthub.selectWorkspace({ workspacePath: workspacePath || undefined });
      setWorkspacePath(nextWorkspace);
      setSelectedRunId(null);
      setRawLog("");
      await Promise.all([refreshWorkspaceData(nextWorkspace), refreshWorkspaces()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [refreshWorkspaceData, refreshWorkspaces, workspacePath]);

  const activateWorkspace = useCallback(
    async (nextWorkspacePath: string) => {
      if (nextWorkspacePath === workspacePath) {
        return;
      }
      setError(null);
      try {
        const nextWorkspace = await window.agenthub.activateWorkspace({ workspacePath: nextWorkspacePath });
        setWorkspacePath(nextWorkspace);
        setSelectedRunId(null);
        setRawLog("");
        setSelectedSessionId((current) => pickSelectedSessionId(current, filterSessionsForWorkspace(sessions, nextWorkspace)));
        await Promise.all([refreshWorkspaceData(nextWorkspace), refreshWorkspaces()]);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [refreshWorkspaceData, refreshWorkspaces, sessions, workspacePath],
  );

  useEffect(() => {
    let isMounted = true;

    window.agenthub
      .getDefaultWorkspace()
      .then(async (defaultWorkspace) => {
        if (!isMounted) {
          return;
        }
        setWorkspacePath(defaultWorkspace);
        await Promise.all([refreshProfilesAndSessions(), refreshWorkspaceData(defaultWorkspace), refreshWorkspaces()]);
      })
      .catch((reason: unknown) => {
        if (isMounted) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      isMounted = false;
    };
  }, [refreshProfilesAndSessions, refreshWorkspaceData, refreshWorkspaces]);

  useEffect(() => {
    return window.agenthub.onTerminalData((event) => {
      setTerminalPreviews((current) => ({
        ...current,
        [event.sessionId]: appendTerminalPreview(current[event.sessionId] ?? "", event.data),
      }));
    });
  }, []);

  useEffect(() => {
    const list = eventListRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [events]);

  useEffect(() => {
    setSelectedMentionIndex((current) => Math.min(current, Math.max(mentionCandidates.length - 1, 0)));
  }, [mentionCandidates.length]);

  useEffect(() => {
    if (selectedProfile) {
      setEditorFields(profileToFields(selectedProfile));
    } else {
      setEditorFields(emptyEditorFields);
    }
  }, [selectedProfile]);

  useEffect(() => {
    setSelectedSessionId((current) => pickSelectedSessionId(current, activeSessions));
  }, [activeSessions]);

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
      void Promise.all([refreshWorkspaceData(), refreshWorkspaces()]);
    });
  }, [activeSessions, refreshWorkspaceData, refreshWorkspaces]);

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
        await Promise.all([refreshWorkspaceData(session.workspacePath), refreshWorkspaces()]);
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
    [refreshWorkspaceData, refreshWorkspaces, workspacePath],
  );

  const stopSession = useCallback(
    async (sessionId: string) => {
      setError(null);
      try {
        await window.agenthub.stopSession(sessionId);
        setSessions((current) =>
          current.map((session) => (session.sessionId === sessionId ? { ...session, status: "exited" as const } : session)),
        );
        await Promise.all([refreshWorkspaceData(), refreshWorkspaces()]);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [refreshWorkspaceData, refreshWorkspaces],
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
    setMentionQuery(null);

    try {
      const routed = await window.agenthub.routeInput({ workspacePath: workspacePath || undefined, text });
      await refreshWorkspaceData();

      if (!routed.targetProfileId) {
        await appendErrorEvent(UI_TEXT.errors.addTargetPrefix);
        return;
      }

      const targetSession =
        findOnlineSessionForProfile(routed.targetProfileId, sessions, workspacePath) ??
        findOnlineSessionForTarget(text, sessions, profiles, workspacePath);

      if (!targetSession) {
        const profile = profiles.find((candidate) => candidate.id === routed.targetProfileId);
        await appendErrorEvent(UI_TEXT.errors.targetNotOnline(profile?.name ?? routed.targetProfileId));
        return;
      }

      if (quotedMessage) {
        const created = await window.agenthub.createForward({
          workspacePath: workspacePath || undefined,
          sourceProfileId: quotedMessage.sourceProfileId,
          targetProfileId: routed.targetProfileId,
          message: buildQuotedForwardMessage(quotedMessage, routed.message),
        });
        const sent = await window.agenthub.sendForward({
          workspacePath: workspacePath || undefined,
          forwardId: created.id,
        });
        if (sent.sessionId) {
          setSelectedSessionId(sent.sessionId);
        }
        setQuotedMessage(null);
        await refreshWorkspaceData();
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
  }, [appendErrorEvent, inputText, profiles, quotedMessage, refreshWorkspaceData, sessions, workspacePath]);

  const selectMentionCandidate = useCallback(
    (profileId: string) => {
      if (!mentionQuery) {
        return;
      }
      const next = applyMentionSelection(inputText, mentionQuery, profileId);
      setInputText(next.text);
      setMentionQuery(null);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(next.cursor, next.cursor);
      });
    },
    [inputText, mentionQuery],
  );

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (mentionQuery && mentionCandidates.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSelectedMentionIndex((current) => (current + 1) % mentionCandidates.length);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSelectedMentionIndex((current) => (current - 1 + mentionCandidates.length) % mentionCandidates.length);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          selectMentionCandidate(mentionCandidates[selectedMentionIndex]?.id ?? mentionCandidates[0].id);
          return;
        }
      }

      if (event.key === "Escape" && mentionQuery) {
        event.preventDefault();
        setMentionQuery(null);
        return;
      }

      if (event.key === "Enter") {
        void routeMessage();
      }
    },
    [mentionCandidates, mentionQuery, routeMessage, selectMentionCandidate, selectedMentionIndex],
  );

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

  const prepareForwardFromEvent = useCallback(
    (event: AgentHubEventDto) => {
      setQuotedMessage({
        sender: chatSenderLabel(event),
        sourceProfileId: event.profileId ?? event.targetProfileId ?? null,
        message: describeEvent(event),
      });
      inputRef.current?.focus();
    },
    [],
  );

  const prepareForwardFromSelectedOutput = useCallback(() => {
    if (!selectedSession || !selectedSessionPreview) {
      return;
    }
    setQuotedMessage({
      sender: selectedSession.profileName,
      sourceProfileId: selectedSession.profileId,
      message: selectedSessionPreview,
    });
    inputRef.current?.focus();
  }, [selectedSession, selectedSessionPreview]);

  const publishSelectedOutput = useCallback(async () => {
    if (!selectedSession || !selectedSessionPreview) {
      return;
    }
    setError(null);
    try {
      await window.agenthub.appendEvent({
        workspacePath: workspacePath || undefined,
        type: "agent_output",
        profileId: selectedSession.profileId,
        profileName: selectedSession.profileName,
        sessionId: selectedSession.sessionId,
        runId: selectedSession.runId,
        message: selectedSessionPreview,
      });
      await refreshWorkspaceData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [refreshWorkspaceData, selectedSession, selectedSessionPreview, workspacePath]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <h1>AgentHub</h1>
          <p title={UI_TEXT.currentWorkspaceHint}>{workspacePath || UI_TEXT.loadingWorkspace}</p>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={() => void openWorkspace()}>
            {UI_TEXT.buttons.openWorkspace}
          </button>
          <button type="button" onClick={() => setIsLogDrawerOpen(true)}>
            日志
          </button>
          <button type="button" onClick={() => void refreshAll()}>
            {UI_TEXT.buttons.refresh}
          </button>
          <span className="summary-pill">
            {activeSessions.length} {UI_TEXT.summaries.onlineSuffix}
          </span>
        </div>
      </header>

      {error ? <section className="error-banner">{error}</section> : null}

      <section className="dashboard-grid">
        <aside className="sidebar">
          <section className="workspace-tabs panel">
            <div className="panel-header">
              <h2>工作区</h2>
              <button type="button" onClick={() => void openWorkspace()}>
                添加
              </button>
            </div>
            <div className="workspace-list">
              {workspaces.map((workspace) => (
                <button
                  type="button"
                  className={`workspace-row ${workspace.isActive || workspace.path === workspacePath ? "is-selected" : ""}`}
                  key={workspace.path}
                  onClick={() => void activateWorkspace(workspace.path)}
                  title={workspace.path}
                >
                  <strong>{workspace.name}</strong>
                  <span>{workspace.path}</span>
                  <small>{countOnlineSessionsForWorkspace(sessions, workspace.path)} 在线</small>
                </button>
              ))}
            </div>
          </section>

          <section className="profile-panel panel">
            <div className="panel-header">
            <h2>{UI_TEXT.sections.profiles}</h2>
            <button type="button" onClick={() => void createCustomProfile()}>
              {UI_TEXT.buttons.new}
            </button>
          </div>

          <div className="profile-list">
            {profiles.map((profile) => {
              const onlineSessions = sessions.filter(
                (session) =>
                  session.profileId === profile.id &&
                  session.status === "online" &&
                  filterSessionsForWorkspace([session], workspacePath).length > 0,
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
                      {formatStatusLabel(isStarting ? "starting" : onlineSessions.length > 0 ? "online" : "offline")}
                    </span>
                    <button type="button" onClick={() => void startProfile(profile.id)} disabled={isStarting}>
                      {UI_TEXT.buttons.start}
                    </button>
                    {onlineSessions.map((session) => (
                      <button type="button" key={session.sessionId} onClick={() => void stopSession(session.sessionId)}>
                        {UI_TEXT.buttons.stop}
                      </button>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
          </section>

          <section className="editor-block panel">
            <div className="panel-header">
              <h2>{UI_TEXT.sections.profileEditor}</h2>
              <div className="button-row">
                <button type="button" onClick={() => void duplicateSelectedProfile()} disabled={!selectedProfile}>
                  {UI_TEXT.buttons.duplicate}
                </button>
                <button type="button" onClick={() => void deleteSelectedProfile()} disabled={!selectedProfile}>
                  {UI_TEXT.buttons.delete}
                </button>
              </div>
            </div>
            <label>
              {UI_TEXT.labels.name}
              <input
                value={editorFields.name}
                onChange={(event) => setEditorFields((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label>
              {UI_TEXT.labels.command}
              <input
                value={editorFields.command}
                onChange={(event) => setEditorFields((current) => ({ ...current, command: event.target.value }))}
              />
            </label>
            <label>
              {UI_TEXT.labels.args}
              <textarea
                rows={3}
                value={editorFields.argsText}
                onChange={(event) => setEditorFields((current) => ({ ...current, argsText: event.target.value }))}
              />
            </label>
            <label>
              {UI_TEXT.labels.aliases}
              <input
                value={editorFields.aliasesText}
                onChange={(event) => setEditorFields((current) => ({ ...current, aliasesText: event.target.value }))}
              />
            </label>
            <label>
              {UI_TEXT.labels.rolePrompt}
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
              {UI_TEXT.labels.workspaceWriteLock}
            </label>
            <button type="button" onClick={() => void saveSelectedProfile()} disabled={!selectedProfile}>
              {UI_TEXT.buttons.saveProfile}
            </button>
          </section>
        </aside>

        <section className="center-stack">
          <section className="timeline panel">
            <div className="panel-header">
              <h2>{UI_TEXT.sections.conversation}</h2>
              <span>{events.length} 条事件</span>
            </div>
            <div className="event-list chat-list" ref={eventListRef}>
              {events.length === 0 ? <p className="empty-state">{UI_TEXT.empty.events}</p> : null}
              {events.map((event) => (
                <article className={`chat-message ${chatMessageClass(event)} event-${event.type}`} key={event.id}>
                  <div className="chat-bubble">
                    <div className="event-meta chat-meta">
                      <strong>{chatSenderLabel(event)}</strong>
                      <span>{formatTime(event.timestamp)}</span>
                    </div>
                    <p>{describeEvent(event)}</p>
                    <div className="event-actions">
                      <button type="button" onClick={() => prepareForwardFromEvent(event)}>
                        转发
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="input-row composer-row">
              {quotedMessage ? (
                <div className="quote-preview">
                  <div>
                    <strong>引用 {quotedMessage.sender}</strong>
                    <p>{quotedMessage.message}</p>
                  </div>
                  <button type="button" onClick={() => setQuotedMessage(null)}>
                    取消
                  </button>
                </div>
              ) : null}
              {mentionQuery ? (
                <div className="mention-menu">
                  {mentionCandidates.length === 0 ? <div className="mention-empty">没有匹配的 Agent</div> : null}
                  {mentionCandidates.map((profile, index) => {
                    const online = findOnlineSessionForProfile(profile.id, sessions, workspacePath);
                    return (
                      <button
                        type="button"
                        className={`mention-option ${index === selectedMentionIndex ? "is-selected" : ""}`}
                        key={profile.id}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          selectMentionCandidate(profile.id);
                        }}
                      >
                        <strong>{profile.name}</strong>
                        <span>@{profile.id}</span>
                        <small className={online ? "is-online" : ""}>{online ? "在线" : "离线"}</small>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <input
                ref={inputRef}
                value={inputText}
                onChange={(event) => {
                  setInputText(event.target.value);
                  refreshMentionQuery(event.target.value, event.target.selectionStart);
                }}
                onClick={(event) => refreshMentionQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
                onKeyUp={(event) => {
                  if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
                    refreshMentionQuery(event.currentTarget.value, event.currentTarget.selectionStart);
                  }
                }}
                onKeyDown={handleComposerKeyDown}
                placeholder={UI_TEXT.placeholders.routedInput}
              />
              <button type="button" onClick={() => void routeMessage()}>
                {UI_TEXT.buttons.send}
              </button>
            </div>
          </section>

          <section className="orchestration panel">
            <div className="panel-header">
              <h2>{UI_TEXT.sections.orchestration}</h2>
              <span>{UI_TEXT.labels.manualTrigger}</span>
            </div>
            <div className="input-row">
              <input
                value={orchestrationGoal}
                onChange={(event) => setOrchestrationGoal(event.target.value)}
                placeholder={UI_TEXT.placeholders.orchestrationGoal}
              />
              <button type="button" onClick={() => void startOrchestration()}>
                {UI_TEXT.buttons.start}
              </button>
            </div>
          </section>

          {/*
          <section className="forwarding panel" hidden>
            <div className="panel-header">
              <h2>{UI_TEXT.sections.forwarding}</h2>
              <span>{forwards.length} 条转发</span>
            </div>
            <div className="forward-create">
              <select value={forwardSourceProfileId} onChange={(event) => setForwardSourceProfileId(event.target.value)}>
                <option value="">{UI_TEXT.labels.source}</option>
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
                placeholder={UI_TEXT.placeholders.forwardMessage}
              />
              <button type="button" onClick={() => void createForward()}>
                {UI_TEXT.buttons.queue}
              </button>
              <button type="button" onClick={() => void createAndSendForward()}>
                立即发送
              </button>
            </div>
            <div className="forward-list">
              {forwards.length === 0 ? <p className="empty-state">{UI_TEXT.empty.forwards}</p> : null}
              {forwards.map((forward) => (
                <article className="forward-card" key={forward.id}>
                  <div className="forward-meta">
                    <strong>
                      {forward.sourceProfileId ? profileNameById.get(forward.sourceProfileId) ?? forward.sourceProfileId : UI_TEXT.labels.manual}
                      {" -> "}
                      {profileNameById.get(forward.targetProfileId) ?? forward.targetProfileId}
                    </strong>
                    <span className={`status-pill ${statusClass(forward.status)}`}>{formatStatusLabel(forward.status)}</span>
                  </div>
                  <p>{forward.message}</p>
                  {forward.lastError ? <p className="forward-error">{forward.lastError}</p> : null}
                  <div className="button-row">
                    <button
                      type="button"
                      onClick={() => void sendForward(forward.id)}
                      disabled={forward.status === "sent" || forward.status === "stopped"}
                    >
                      {UI_TEXT.buttons.send}
                    </button>
                    <button
                      type="button"
                      onClick={() => void pauseForward(forward.id)}
                      disabled={forward.status === "sent" || forward.status === "paused" || forward.status === "stopped"}
                    >
                      {UI_TEXT.buttons.pause}
                    </button>
                    <button type="button" onClick={() => void stopForward(forward.id)} disabled={forward.status === "stopped"}>
                      {UI_TEXT.buttons.stop}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          */}
          <section className="tasks panel">
            <div className="panel-header">
              <h2>{UI_TEXT.sections.tasks}</h2>
              <span>{tasks.length} 个任务</span>
            </div>
            <div className="task-create">
              <input
                value={newTaskTitle}
                onChange={(event) => setNewTaskTitle(event.target.value)}
                placeholder={UI_TEXT.placeholders.taskTitle}
              />
              <input
                value={newTaskDescription}
                onChange={(event) => setNewTaskDescription(event.target.value)}
                placeholder={UI_TEXT.placeholders.taskDescription}
              />
              <button type="button" onClick={() => void createTask()}>
                {UI_TEXT.buttons.create}
              </button>
            </div>
            <div className="task-columns">
              {TASK_STATUSES.map((status) => (
                <section className="task-column" key={status}>
                  <h3>{formatStatusLabel(status)}</h3>
                  {tasks
                    .filter((task) => task.status === status)
                    .map((task) => (
                      <article className="task-card" key={task.id}>
                        <strong>{task.title}</strong>
                        {task.description ? <p>{task.description}</p> : null}
                        <select value={task.status} onChange={(event) => void updateTaskStatus(task, event.target.value as TaskStatus)}>
                          {TASK_STATUSES.map((option) => (
                            <option value={option} key={option}>
                              {formatStatusLabel(option)}
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
              <h2>{UI_TEXT.sections.terminals}</h2>
              <div className="button-row">
                {selectedSession ? (
                  <>
                    <button type="button" onClick={() => void publishSelectedOutput()} disabled={!selectedSessionPreview}>
                      保存为结果
                    </button>
                    <button type="button" onClick={prepareForwardFromSelectedOutput} disabled={!selectedSessionPreview}>
                      转发最近输出
                    </button>
                    <button type="button" onClick={() => void stopSession(selectedSession.sessionId)}>
                      {UI_TEXT.buttons.stopSelected}
                    </button>
                  </>
                ) : null}
              </div>
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
              {activeSessions.length === 0 ? <p className="empty-state">{UI_TEXT.empty.terminals}</p> : null}
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

          {/*
          <section className="runs panel">
            <div className="panel-header">
              <h2>{UI_TEXT.sections.runs}</h2>
              <span>{filteredRuns.length} 条记录</span>
            </div>
            <div className="filter-row">
              <select value={runProfileFilter} onChange={(event) => setRunProfileFilter(event.target.value)}>
                <option value="all">{UI_TEXT.labels.allProfiles}</option>
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
                    {formatStatusLabel(status)}
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
                  <span className={`status-pill ${statusClass(run.status)}`}>{formatStatusLabel(run.status)}</span>
                </button>
              ))}
            </div>
            <pre className="raw-log">{rawLog || UI_TEXT.empty.rawLog}</pre>
          </section>
          */}
        </aside>
      </section>
      {isLogDrawerOpen ? (
        <section className="drawer-backdrop" role="presentation">
          <aside className="log-drawer panel" aria-label="运行日志">
            <div className="panel-header">
              <h2>{UI_TEXT.sections.runs}</h2>
              <div className="button-row">
                <span>{filteredRuns.length} 条记录</span>
                <button type="button" onClick={() => setIsLogDrawerOpen(false)}>
                  关闭
                </button>
              </div>
            </div>
            <div className="filter-row">
              <select value={runProfileFilter} onChange={(event) => setRunProfileFilter(event.target.value)}>
                <option value="all">{UI_TEXT.labels.allProfiles}</option>
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
                    {formatStatusLabel(status)}
                  </option>
                ))}
              </select>
            </div>
            <div className="log-drawer-body">
              <div className="run-list">
                {filteredRuns.map((run) => (
                  <button
                    type="button"
                    className={`run-row ${selectedRunId === run.runId ? "is-selected" : ""}`}
                    key={run.runId}
                    onClick={() => void loadRunRawLog(run.runId)}
                  >
                    <span>{run.profileId}</span>
                    <span className={`status-pill ${statusClass(run.status)}`}>{formatStatusLabel(run.status)}</span>
                  </button>
                ))}
              </div>
              <pre className="raw-log">{rawLog || UI_TEXT.empty.rawLog}</pre>
            </div>
          </aside>
        </section>
      ) : null}
    </main>
  );
}
