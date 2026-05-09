import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  AgentConversationDto,
  AgentHubEventDto,
  AgentProfileDto,
  ConversationStatus,
  RunHistoryDto,
  SessionStatus,
  StartPowerShellResponse,
  TaskPlanDto,
  TaskPlanSourceDto,
  TaskPlanStatus,
  WorkspaceDto,
} from "../../shared/ipc";
import {
  appendTerminalPreview,
  applyMentionSelection,
  buildQuotedForwardMessage,
  buildProfileSavePayload,
  buildTaskPlanGenerationPrompt,
  buildTerminalSubmitInput,
  canResumeProfile,
  clampTaskPlanSplitRatio,
  countOnlineSessionsForWorkspace,
  describeConversationEvent,
  filterActiveConversations,
  filterConversationEvents,
  filterSessionsForWorkspace,
  findMentionQuery,
  formatConversationModeLabel,
  formatConversationStatusLabel,
  formatCenterStackRows,
  formatParticipantLabel,
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

const RUN_STATUSES: Array<RunHistoryDto["status"] | "all"> = ["all", "running", "exited"];
const LAYOUT_STORAGE_KEYS = {
  sidebarCollapsed: "agenthub.layout.sidebarCollapsed",
  taskPlanCollapsed: "agenthub.layout.taskPlanCollapsed",
  taskPlanSplitRatio: "agenthub.layout.taskPlanSplitRatio",
} as const;

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

function statusClass(status: SessionStatus | RunHistoryDto["status"] | TaskPlanStatus | ConversationStatus): string {
  return `status-${status}`;
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

type WorkspaceContextMenuState = {
  workspacePath: string;
  x: number;
  y: number;
};

type MainTab = "conversation" | `terminal:${string}`;

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    if (typeof window === "undefined") {
      return fallback;
    }
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function readStoredTaskPlanSplitRatio(): number {
  try {
    if (typeof window === "undefined") {
      return clampTaskPlanSplitRatio(Number.NaN);
    }
    const value = window.localStorage.getItem(LAYOUT_STORAGE_KEYS.taskPlanSplitRatio);
    return value === null ? clampTaskPlanSplitRatio(Number.NaN) : clampTaskPlanSplitRatio(Number(value));
  } catch {
    return clampTaskPlanSplitRatio(Number.NaN);
  }
}

function writeStoredLayoutValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Layout persistence is optional; ignore private-mode or storage quota failures.
  }
}

export function App(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const eventListRef = useRef<HTMLDivElement | null>(null);
  const centerStackRef = useRef<HTMLDivElement | null>(null);
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [profiles, setProfiles] = useState<AgentProfileDto[]>([]);
  const [sessions, setSessions] = useState<StartPowerShellResponse[]>([]);
  const [events, setEvents] = useState<AgentHubEventDto[]>([]);
  const [conversations, setConversations] = useState<AgentConversationDto[]>([]);
  const [runs, setRuns] = useState<RunHistoryDto[]>([]);
  const [taskPlans, setTaskPlans] = useState<TaskPlanDto[]>([]);
  const [taskPlanSources, setTaskPlanSources] = useState<TaskPlanSourceDto[]>([]);
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
  const [selectedTaskPlanId, setSelectedTaskPlanId] = useState<string | null>(null);
  const [taskPlanMarkdown, setTaskPlanMarkdown] = useState("");
  const [newTaskPlanTitle, setNewTaskPlanTitle] = useState("");
  const [selectedTaskPlanSourceDirectory, setSelectedTaskPlanSourceDirectory] = useState("");
  const [terminalPreviews, setTerminalPreviews] = useState<Record<string, string>>({});
  const [quotedMessage, setQuotedMessage] = useState<QuotedChatMessage | null>(null);
  const [isLogDrawerOpen, setIsLogDrawerOpen] = useState(false);
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [workspaceContextMenu, setWorkspaceContextMenu] = useState<WorkspaceContextMenuState | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("conversation");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() =>
    readStoredBoolean(LAYOUT_STORAGE_KEYS.sidebarCollapsed, false),
  );
  const [isTaskPlanCollapsed, setIsTaskPlanCollapsed] = useState(() =>
    readStoredBoolean(LAYOUT_STORAGE_KEYS.taskPlanCollapsed, false),
  );
  const [taskPlanSplitRatio, setTaskPlanSplitRatio] = useState(readStoredTaskPlanSplitRatio);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? null,
    [profiles, selectedProfileId],
  );
  const activeSessions = useMemo(() => filterSessionsForWorkspace(sessions, workspacePath), [sessions, workspacePath]);
  const selectedProfileOnlineCount = useMemo(
    () => activeSessions.filter((session) => session.profileId === selectedProfile?.id && session.status === "online").length,
    [activeSessions, selectedProfile?.id],
  );
  const conversationEvents = useMemo(() => filterConversationEvents(events), [events]);
  const activeConversations = useMemo(() => filterActiveConversations(conversations), [conversations]);
  const selectedTaskPlan = useMemo(
    () => taskPlans.find((plan) => plan.id === selectedTaskPlanId) ?? null,
    [selectedTaskPlanId, taskPlans],
  );
  const selectedTaskPlanSource = useMemo(
    () => taskPlanSources.find((source) => source.directoryName === selectedTaskPlanSourceDirectory) ?? null,
    [selectedTaskPlanSourceDirectory, taskPlanSources],
  );
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
  const contextMenuWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.path === workspaceContextMenu?.workspacePath) ?? null,
    [workspaceContextMenu?.workspacePath, workspaces],
  );
  const centerStackRows = useMemo(
    () => formatCenterStackRows({ taskPlanCollapsed: isTaskPlanCollapsed, taskPlanRatio: taskPlanSplitRatio }),
    [isTaskPlanCollapsed, taskPlanSplitRatio],
  );

  useEffect(() => {
    writeStoredLayoutValue(LAYOUT_STORAGE_KEYS.sidebarCollapsed, String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  useEffect(() => {
    writeStoredLayoutValue(LAYOUT_STORAGE_KEYS.taskPlanCollapsed, String(isTaskPlanCollapsed));
  }, [isTaskPlanCollapsed]);

  useEffect(() => {
    writeStoredLayoutValue(LAYOUT_STORAGE_KEYS.taskPlanSplitRatio, String(taskPlanSplitRatio));
  }, [taskPlanSplitRatio]);

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
    const [nextEvents, nextConversations, nextRuns, nextTaskPlans, nextTaskPlanSources] = await Promise.all([
      window.agenthub.listEvents(request),
      window.agenthub.listConversations(request),
      window.agenthub.listRuns(request),
      window.agenthub.listTaskPlans(request),
      window.agenthub.listTaskPlanSources(request),
    ]);
    setEvents(nextEvents);
    setConversations(nextConversations);
    setRuns(nextRuns);
    setTaskPlans(nextTaskPlans);
    setTaskPlanSources(nextTaskPlanSources);
    setSelectedTaskPlanSourceDirectory((current) => {
      if (current && nextTaskPlanSources.some((source) => source.directoryName === current)) {
        return current;
      }
      return nextTaskPlanSources[0]?.directoryName ?? "";
    });
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
      setSelectedTaskPlanId(null);
      setTaskPlanMarkdown("");
      setSelectedTaskPlanSourceDirectory("");
      setMainTab("conversation");
      await Promise.all([refreshWorkspaceData(nextWorkspace), refreshWorkspaces()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [refreshWorkspaceData, refreshWorkspaces, workspacePath]);

  const activateWorkspace = useCallback(
    async (nextWorkspacePath: string) => {
      if (nextWorkspacePath === workspacePath) {
        return true;
      }
      setError(null);
      try {
        const nextWorkspace = await window.agenthub.activateWorkspace({ workspacePath: nextWorkspacePath });
        setWorkspacePath(nextWorkspace);
        setSelectedRunId(null);
        setRawLog("");
        setSelectedTaskPlanId(null);
        setTaskPlanMarkdown("");
        setSelectedTaskPlanSourceDirectory("");
        setMainTab("conversation");
        setSelectedSessionId((current) => pickSelectedSessionId(current, filterSessionsForWorkspace(sessions, nextWorkspace)));
        await Promise.all([refreshWorkspaceData(nextWorkspace), refreshWorkspaces()]);
        return true;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        return false;
      }
    },
    [refreshWorkspaceData, refreshWorkspaces, sessions, workspacePath],
  );

  const refreshWorkspaceCard = useCallback(
    async (nextWorkspacePath: string) => {
      if (nextWorkspacePath !== workspacePath) {
        await activateWorkspace(nextWorkspacePath);
        return;
      }
      setError(null);
      try {
        await refreshAll();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [activateWorkspace, refreshAll, workspacePath],
  );

  const openWorkspaceLogs = useCallback(
    async (nextWorkspacePath: string) => {
      const activated = await activateWorkspace(nextWorkspacePath);
      if (activated) {
        setIsLogDrawerOpen(true);
      }
    },
    [activateWorkspace],
  );

  const closeWorkspaceContextMenu = useCallback(() => {
    setWorkspaceContextMenu(null);
  }, []);

  const openWorkspaceContextMenu = useCallback((event: MouseEvent<HTMLElement>, targetWorkspacePath: string) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 220;
    const menuHeight = 190;
    setWorkspaceContextMenu({
      workspacePath: targetWorkspacePath,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    });
  }, []);

  const openWorkspaceFolder = useCallback(
    async (targetWorkspacePath: string) => {
      closeWorkspaceContextMenu();
      setError(null);
      try {
        await window.agenthub.openWorkspaceFolder({ workspacePath: targetWorkspacePath });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [closeWorkspaceContextMenu],
  );

  const deleteWorkspace = useCallback(
    async (targetWorkspacePath: string) => {
      closeWorkspaceContextMenu();
      if (targetWorkspacePath === workspacePath) {
        setError("当前工作区正在使用，先切换到其他工作区后再删除。");
        return;
      }
      const confirmed = window.confirm("仅从 AgentHub 工作区列表移除，不会删除磁盘上的文件夹。确定删除吗？");
      if (!confirmed) {
        return;
      }
      setError(null);
      try {
        const nextWorkspaces = await window.agenthub.deleteWorkspace({ workspacePath: targetWorkspacePath });
        setWorkspaces(nextWorkspaces);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [closeWorkspaceContextMenu, workspacePath],
  );

  useEffect(() => {
    if (!workspaceContextMenu) {
      return undefined;
    }
    const hide = () => closeWorkspaceContextMenu();
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeWorkspaceContextMenu();
      }
    };
    window.addEventListener("click", hide);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("click", hide);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
    };
  }, [closeWorkspaceContextMenu, workspaceContextMenu]);

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
    return window.agenthub.onEventAppended((notification) => {
      if (notification.workspacePath !== workspacePath) {
        return;
      }
      setEvents((current) => {
        if (current.some((event) => event.id === notification.event.id)) {
          return current;
        }
        return [...current, notification.event];
      });
      const request = { workspacePath: workspacePath || undefined };
      void Promise.all([window.agenthub.listConversations(request), window.agenthub.listTaskPlans(request)])
        .then(([nextConversations, nextTaskPlans]) => {
          setConversations(nextConversations);
          setTaskPlans(nextTaskPlans);
        })
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    });
  }, [workspacePath]);

  useEffect(() => {
    const list = eventListRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [conversationEvents]);

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
    if (selectedTaskPlanId && !taskPlans.some((plan) => plan.id === selectedTaskPlanId)) {
      setSelectedTaskPlanId(null);
      setTaskPlanMarkdown("");
    }
  }, [selectedTaskPlanId, taskPlans]);

  useEffect(() => {
    if (!selectedTaskPlanSourceDirectory && taskPlanSources[0]) {
      setSelectedTaskPlanSourceDirectory(taskPlanSources[0].directoryName);
    }
    if (
      selectedTaskPlanSourceDirectory &&
      !taskPlanSources.some((source) => source.directoryName === selectedTaskPlanSourceDirectory)
    ) {
      setSelectedTaskPlanSourceDirectory(taskPlanSources[0]?.directoryName ?? "");
    }
  }, [selectedTaskPlanSourceDirectory, taskPlanSources]);

  useEffect(() => {
    if (selectedTaskPlanSource) {
      setNewTaskPlanTitle((current) => (current.trim() ? current : selectedTaskPlanSource.title));
    }
  }, [selectedTaskPlanSource]);

  useEffect(() => {
    setMainTab((current) => {
      if (current === "conversation") {
        return current;
      }
      const sessionId = current.replace(/^terminal:/, "");
      return activeSessions.some((session) => session.sessionId === sessionId) ? current : "conversation";
    });
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
      setMainTab((current) => (current === `terminal:${event.sessionId}` ? "conversation" : current));
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
    async (profileId: string, resumeLast = false) => {
      setError(null);
      setStartingProfileIds((current) => new Set(current).add(profileId));
      try {
        const session = await window.agenthub.startProfile({
          profileId,
          workspacePath: workspacePath || undefined,
          cols: 120,
          rows: 32,
          resumeLast,
        });
        setWorkspacePath(session.workspacePath);
        setSessions((current) => [session, ...current.filter((item) => item.sessionId !== session.sessionId)]);
        setSelectedSessionId(session.sessionId);
        setMainTab(`terminal:${session.sessionId}`);
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
        setMainTab((current) => (current === `terminal:${sessionId}` ? "conversation" : current));
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

  const beginCenterSplitResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const centerStack = centerStackRef.current;
    if (!centerStack) {
      return;
    }
    event.preventDefault();
    setIsTaskPlanCollapsed(false);

    const updateRatio = (clientY: number) => {
      const rect = centerStack.getBoundingClientRect();
      if (rect.height <= 0) {
        return;
      }
      setTaskPlanSplitRatio(clampTaskPlanSplitRatio((rect.bottom - clientY) / rect.height));
    };

    updateRatio(event.clientY);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => updateRatio(moveEvent.clientY);
    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }, []);

  const openProfileEditor = useCallback(
    (profileId: string) => {
      setSelectedProfileId(profileId);
      const profile = profiles.find((candidate) => candidate.id === profileId);
      if (profile) {
        setEditorFields(profileToFields(profile));
      }
      setIsLogDrawerOpen(false);
      setIsProfileEditorOpen(true);
    },
    [profiles],
  );

  const closeProfileEditor = useCallback(() => {
    if (selectedProfile) {
      setEditorFields(profileToFields(selectedProfile));
    }
    setIsProfileEditorOpen(false);
  }, [selectedProfile]);

  const saveSelectedProfile = useCallback(async () => {
    if (!selectedProfile) {
      return;
    }
    setError(null);
    try {
      const patch = buildProfileSavePayload(selectedProfile, editorFields);
      const updated = await window.agenthub.updateProfile({ id: selectedProfile.id, patch });
      setProfiles((current) => current.map((profile) => (profile.id === updated.id ? updated : profile)));
      setIsProfileEditorOpen(false);
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
      setEditorFields(profileToFields(created));
      setIsProfileEditorOpen(true);
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
      setEditorFields(profileToFields(duplicate));
      setIsProfileEditorOpen(true);
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
      setIsProfileEditorOpen(false);
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

  const sendRoutedText = useCallback(async (rawText: string, options: { asTaskPlanPrompt?: boolean } = {}) => {
    const text = rawText.trim();
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

      const outboundMessage = options.asTaskPlanPrompt
        ? buildTaskPlanGenerationPrompt(routed.message)
        : routed.message;

      if (quotedMessage && !options.asTaskPlanPrompt) {
        const created = await window.agenthub.createForward({
          workspacePath: workspacePath || undefined,
          sourceProfileId: quotedMessage.sourceProfileId,
          targetProfileId: routed.targetProfileId,
          message: buildQuotedForwardMessage(quotedMessage, outboundMessage),
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
        data: buildTerminalSubmitInput(
          profiles.find((profile) => profile.id === targetSession.profileId),
          outboundMessage,
        ),
      });
      setSelectedSessionId(targetSession.sessionId);
      if (options.asTaskPlanPrompt) {
        setQuotedMessage(null);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      await appendErrorEvent(message);
    }
  }, [appendErrorEvent, profiles, quotedMessage, refreshWorkspaceData, sessions, workspacePath]);

  const routeMessage = useCallback(async () => {
    await sendRoutedText(inputText);
  }, [inputText, sendRoutedText]);

  const sendTaskPlanGenerationPrompt = useCallback(async () => {
    await sendRoutedText(inputText, { asTaskPlanPrompt: true });
  }, [inputText, sendRoutedText]);

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

  const loadTaskPlanMarkdown = useCallback(
    async (planId: string) => {
      setError(null);
      try {
        const markdown = await window.agenthub.readTaskPlanMarkdown({
          workspacePath: workspacePath || undefined,
          planId,
        });
        setSelectedTaskPlanId(planId);
        setTaskPlanMarkdown(markdown);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [workspacePath],
  );

  const createTaskPlan = useCallback(async () => {
    const title = newTaskPlanTitle.trim();
    const sourceTaskDirectoryName = selectedTaskPlanSourceDirectory.trim();
    if (!title || !sourceTaskDirectoryName) {
      return;
    }
    const managerProfileId = profiles.find((profile) => profile.kind === "claude")?.id ?? "claude";
    const preferredParticipantProfileIds = profiles
      .filter((profile) => (profile.kind === "codex" || profile.kind === "gemini") && profile.id !== managerProfileId)
      .map((profile) => profile.id);
    const fallbackParticipantProfileIds = profiles
      .filter((profile) => profile.id !== managerProfileId)
      .map((profile) => profile.id);
    const participantProfileIds =
      preferredParticipantProfileIds.length > 0 ? preferredParticipantProfileIds : fallbackParticipantProfileIds;
    if (participantProfileIds.length === 0) {
      setError("至少需要一个参与智能体。");
      return;
    }
    setError(null);
    try {
      const created = await window.agenthub.createTaskPlan({
        workspacePath: workspacePath || undefined,
        title,
        sourceTaskDirectoryName,
        managerProfileId,
        participantProfileIds,
      });
      const [nextTaskPlans, nextMarkdown] = await Promise.all([
        window.agenthub.listTaskPlans({ workspacePath: workspacePath || undefined }),
        window.agenthub.readTaskPlanMarkdown({ workspacePath: workspacePath || undefined, planId: created.id }),
      ]);
      setTaskPlans(nextTaskPlans);
      setSelectedTaskPlanId(created.id);
      setTaskPlanMarkdown(nextMarkdown);
      setNewTaskPlanTitle("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [newTaskPlanTitle, profiles, selectedTaskPlanSourceDirectory, workspacePath]);

  const startSelectedTaskPlanManager = useCallback(async () => {
    if (!selectedTaskPlanId) {
      return;
    }
    setError(null);
    try {
      const updated = await window.agenthub.startTaskPlanManager({
        workspacePath: workspacePath || undefined,
        planId: selectedTaskPlanId,
      });
      setTaskPlans((current) => current.map((plan) => (plan.id === updated.id ? updated : plan)));
      await refreshWorkspaceData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [refreshWorkspaceData, selectedTaskPlanId, workspacePath]);

  const openSelectedTaskPlanFolder = useCallback(async () => {
    if (!selectedTaskPlanId) {
      return;
    }
    setError(null);
    try {
      await window.agenthub.openTaskPlanFolder({
        workspacePath: workspacePath || undefined,
        planId: selectedTaskPlanId,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [selectedTaskPlanId, workspacePath]);

  const startManagerConversation = useCallback(async () => {
    const topic = inputText.trim();
    if (!topic) {
      return;
    }
    setError(null);
    try {
      await window.agenthub.startManagerConversation({
        workspacePath: workspacePath || undefined,
        topic,
        supervisorProfileId: "claude",
        participantProfileIds: ["codex", "gemini"],
      });
      setInputText("");
      setMentionQuery(null);
      setQuotedMessage(null);
      await refreshWorkspaceData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [inputText, refreshWorkspaceData, workspacePath]);

  const startRoundtableConversation = useCallback(async () => {
    const topic = inputText.trim();
    if (!topic) {
      return;
    }
    setError(null);
    try {
      await window.agenthub.startRoundtableConversation({
        workspacePath: workspacePath || undefined,
        topic,
        participantProfileIds: ["claude", "codex", "gemini"],
      });
      setInputText("");
      setMentionQuery(null);
      setQuotedMessage(null);
      await refreshWorkspaceData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [inputText, refreshWorkspaceData, workspacePath]);

  const startPairNegotiationConversation = useCallback(async () => {
    const topic = inputText.trim();
    if (!topic) {
      return;
    }
    setError(null);
    try {
      const claudeProfileId = profiles.find((profile) => profile.kind === "claude")?.id ?? "claude";
      const codexProfileId = profiles.find((profile) => profile.kind === "codex")?.id ?? "codex";
      await window.agenthub.startPairNegotiationConversation({
        workspacePath: workspacePath || undefined,
        topic,
        participantProfileIds: [claudeProfileId, codexProfileId],
      });
      setInputText("");
      setMentionQuery(null);
      setQuotedMessage(null);
      await refreshWorkspaceData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [inputText, profiles, refreshWorkspaceData, workspacePath]);

  const updateConversationStatus = useCallback(
    async (conversationId: string, action: "pause" | "resume" | "stop") => {
      setError(null);
      try {
        const request = { workspacePath: workspacePath || undefined, conversationId };
        const updated =
          action === "pause"
            ? await window.agenthub.pauseConversation(request)
            : action === "resume"
              ? await window.agenthub.resumeConversation(request)
              : await window.agenthub.stopConversation(request);
        setConversations((current) => [updated, ...current.filter((conversation) => conversation.id !== updated.id)]);
        await refreshWorkspaceData();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [refreshWorkspaceData, workspacePath],
  );

  const prepareForwardFromEvent = useCallback(
    (event: AgentHubEventDto) => {
      setQuotedMessage({
        sender: chatSenderLabel(event),
        sourceProfileId: event.profileId ?? event.targetProfileId ?? null,
        message: describeConversationEvent(event),
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
      {error ? <section className="error-banner">{error}</section> : null}

      <section className={`dashboard-grid ${isSidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
        <aside className={`sidebar ${isSidebarCollapsed ? "is-collapsed" : ""}`}>
          {isSidebarCollapsed ? (
            <div className="sidebar-rail" aria-label="收起的侧边栏">
              <button type="button" className="sidebar-rail-button" title="展开侧边栏" onClick={() => setIsSidebarCollapsed(false)}>
                ≡
              </button>
              <button
                type="button"
                className="sidebar-rail-button"
                title={workspacePath || "工作区"}
                onClick={() => setIsSidebarCollapsed(false)}
              >
                工
              </button>
              <div className="sidebar-rail-separator" />
              {profiles.map((profile) => {
                const online = activeSessions.some((session) => session.profileId === profile.id);
                return (
                  <button
                    type="button"
                    className={`sidebar-rail-button ${selectedProfile?.id === profile.id ? "is-selected" : ""}`}
                    key={profile.id}
                    title={`${profile.name} (${online ? "在线" : "离线"})`}
                    onClick={() => setSelectedProfileId(profile.id)}
                  >
                    <span>{profile.id.slice(0, 2).toUpperCase()}</span>
                    <i className={online ? "is-online" : ""} />
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className="sidebar-toolbar">
                <button type="button" onClick={() => setIsSidebarCollapsed(true)}>
                  收起侧边栏
                </button>
              </div>
          <section className="workspace-tabs panel">
            <div className="panel-header">
              <h2>工作区</h2>
              <button type="button" onClick={() => void openWorkspace()}>
                打开/添加
              </button>
            </div>
            <div className="workspace-list">
              {workspaces.map((workspace) => {
                const isCurrentWorkspace = workspace.isActive || workspace.path === workspacePath;
                const onlineCount = countOnlineSessionsForWorkspace(sessions, workspace.path);

                return (
                  <article
                    className={`workspace-row ${isCurrentWorkspace ? "is-selected" : ""}`}
                    key={workspace.path}
                    role="button"
                    tabIndex={0}
                    title={workspace.path}
                    onClick={() => void activateWorkspace(workspace.path)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void activateWorkspace(workspace.path);
                      }
                    }}
                    onContextMenu={(event) => openWorkspaceContextMenu(event, workspace.path)}
                  >
                    <div className="workspace-main">
                      <span className="workspace-title-line">
                        <strong>{workspace.name}</strong>
                        {isCurrentWorkspace ? <span className="workspace-current-pill">当前</span> : null}
                      </span>
                      <span className="workspace-path">{workspace.path}</span>
                    </div>
                    <div className="workspace-meta">
                      <small>{onlineCount} 在线</small>
                      <span>右键操作</span>
                    </div>
                  </article>
                );
              })}
            </div>
            {workspaceContextMenu && contextMenuWorkspace ? (
              <div
                className="workspace-context-menu"
                role="menu"
                style={{ left: workspaceContextMenu.x, top: workspaceContextMenu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeWorkspaceContextMenu();
                    void activateWorkspace(contextMenuWorkspace.path);
                  }}
                  disabled={contextMenuWorkspace.path === workspacePath}
                >
                  切换到此工作区
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeWorkspaceContextMenu();
                    void refreshWorkspaceCard(contextMenuWorkspace.path);
                  }}
                >
                  刷新工作区数据
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeWorkspaceContextMenu();
                    void openWorkspaceLogs(contextMenuWorkspace.path);
                  }}
                >
                  查看运行日志
                </button>
                <button type="button" role="menuitem" onClick={() => void openWorkspaceFolder(contextMenuWorkspace.path)}>
                  在资源管理器中打开
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void deleteWorkspace(contextMenuWorkspace.path)}
                  disabled={contextMenuWorkspace.path === workspacePath}
                >
                  从列表移除
                </button>
              </div>
            ) : null}
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
                      {canResumeProfile(profile) ? (
                        <button type="button" onClick={() => void startProfile(profile.id, true)} disabled={isStarting}>
                          恢复
                        </button>
                      ) : null}
                      <button type="button" onClick={() => openProfileEditor(profile.id)}>
                        编辑
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
            </>
          )}
        </aside>

        <section className="workspace-content">
          <div className="workspace-main-tabs" role="tablist" aria-label="工作区视图">
            <button
              type="button"
              role="tab"
              className={mainTab === "conversation" ? "is-selected" : ""}
              onClick={() => setMainTab("conversation")}
            >
              协作消息
            </button>
            {activeSessions.map((session) => (
              <button
                type="button"
                role="tab"
                className={mainTab === `terminal:${session.sessionId}` ? "is-selected" : ""}
                key={session.sessionId}
                onClick={() => {
                  setSelectedSessionId(session.sessionId);
                  setMainTab(`terminal:${session.sessionId}`);
                }}
              >
                {session.profileName}
              </button>
            ))}
          </div>
          <div className="workspace-tab-stage">
            <section className={`workspace-tab-pane collaboration-pane ${mainTab === "conversation" ? "is-visible" : ""}`}>
              <section className="center-stack" ref={centerStackRef} style={{ gridTemplateRows: centerStackRows }}>
          <section className="timeline panel">
            <div className="panel-header">
              <h2>{UI_TEXT.sections.conversation}</h2>
              <span>{conversationEvents.length} 条消息</span>
            </div>
            <div className="event-list chat-list" ref={eventListRef}>
              {conversationEvents.length === 0 ? <p className="empty-state">{UI_TEXT.empty.events}</p> : null}
              {conversationEvents.map((event) => (
                <article className={`chat-message ${chatMessageClass(event)} event-${event.type}`} key={event.id}>
                  <div className="chat-bubble">
                    <div className="event-meta chat-meta">
                      <strong>{chatSenderLabel(event)}</strong>
                      <span>{formatTime(event.timestamp)}</span>
                    </div>
                    <p>{describeConversationEvent(event)}</p>
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
              <button type="button" onClick={() => void sendTaskPlanGenerationPrompt()} disabled={!inputText.trim()}>
                {UI_TEXT.buttons.generateTaskPlan}
              </button>
              <button type="button" onClick={() => void startManagerConversation()} disabled={!inputText.trim()}>
                交给 Claude 管理
              </button>
              <button type="button" onClick={() => void startRoundtableConversation()} disabled={!inputText.trim()}>
                新建讨论
              </button>
              <button type="button" onClick={() => void startPairNegotiationConversation()} disabled={!inputText.trim()}>
                双人协商
              </button>
            </div>
            <div className="conversation-manager-list">
              {activeConversations.length === 0 ? <p className="empty-state">暂无活跃会话</p> : null}
              {activeConversations.map((conversation) => (
                <article className="conversation-manager-card" key={conversation.id}>
                  <div className="conversation-manager-main">
                    <strong title={conversation.topic}>{conversation.topic}</strong>
                    <span>
                      {formatConversationModeLabel(conversation.mode)} · {formatParticipantLabel(conversation)}
                    </span>
                  </div>
                  <div className="conversation-manager-meta">
                    <span className={`status-pill ${statusClass(conversation.status)}`}>
                      {formatConversationStatusLabel(conversation.status)}
                    </span>
                    <span className="conversation-step">
                      {conversation.currentStep}/{conversation.maxSteps ?? "∞"}
                    </span>
                  </div>
                  <div className="button-row conversation-manager-actions">
                    <button
                      type="button"
                      onClick={() => void updateConversationStatus(conversation.id, "pause")}
                      disabled={conversation.status !== "running"}
                    >
                      暂停
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateConversationStatus(conversation.id, "resume")}
                      disabled={conversation.status !== "paused"}
                    >
                      继续
                    </button>
                    <button type="button" onClick={() => void updateConversationStatus(conversation.id, "stop")}>
                      停止
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <button
            type="button"
            className="center-splitter"
            onPointerDown={beginCenterSplitResize}
            title="拖拽调整协作消息和任务计划高度"
            aria-label="调整协作消息和任务计划高度"
          />

          <section className={`task-plan-panel panel ${isTaskPlanCollapsed ? "is-collapsed" : ""}`}>
            <div className="panel-header">
              <h2>{UI_TEXT.sections.taskPlans}</h2>
              <div className="button-row">
                <span>{taskPlans.length} 个计划</span>
                <button type="button" onClick={() => setIsTaskPlanCollapsed((current) => !current)}>
                  {isTaskPlanCollapsed ? "显示" : "收起"}
                </button>
              </div>
            </div>
            {!isTaskPlanCollapsed ? (
              <>
            <div className="task-plan-create">
              <select
                value={selectedTaskPlanSourceDirectory}
                onChange={(event) => {
                  const source = taskPlanSources.find((candidate) => candidate.directoryName === event.target.value) ?? null;
                  setSelectedTaskPlanSourceDirectory(event.target.value);
                  setNewTaskPlanTitle(source?.title ?? "");
                }}
              >
                {taskPlanSources.length === 0 ? <option value="">{UI_TEXT.empty.taskPlanSources}</option> : null}
                {taskPlanSources.map((source) => (
                  <option value={source.directoryName} key={source.directoryName}>
                    {source.title}
                  </option>
                ))}
              </select>
              <input
                value={newTaskPlanTitle}
                onChange={(event) => setNewTaskPlanTitle(event.target.value)}
                placeholder={UI_TEXT.placeholders.taskPlanTitle}
              />
              <span className="task-plan-source-hint">{UI_TEXT.hints.taskPlanSource}</span>
              <button
                type="button"
                onClick={() => void createTaskPlan()}
                disabled={!newTaskPlanTitle.trim() || !selectedTaskPlanSourceDirectory}
              >
                {UI_TEXT.buttons.createTaskPlan}
              </button>
            </div>
            <div className="task-plan-body">
              <div className="task-plan-list">
                {taskPlans.length === 0 ? <p className="empty-state">{UI_TEXT.empty.taskPlans}</p> : null}
                {taskPlans.map((plan) => (
                  <button
                    type="button"
                    className={`task-plan-row ${selectedTaskPlanId === plan.id ? "is-selected" : ""}`}
                    key={plan.id}
                    onClick={() => void loadTaskPlanMarkdown(plan.id)}
                  >
                    <strong>{plan.title}</strong>
                    <span className={`status-pill ${statusClass(plan.status)}`}>{formatStatusLabel(plan.status)}</span>
                    <small>{plan.date || plan.directoryName}</small>
                  </button>
                ))}
              </div>
              <div className="task-plan-detail">
                {selectedTaskPlan ? (
                  <>
                    <div className="task-plan-detail-header">
                      <div>
                        <strong>{selectedTaskPlan.title}</strong>
                        <span>{selectedTaskPlan.directoryName}</span>
                      </div>
                      <div className="button-row">
                        <button type="button" onClick={() => void startSelectedTaskPlanManager()}>
                          {UI_TEXT.buttons.startTaskPlanManager}
                        </button>
                        <button type="button" onClick={() => void openSelectedTaskPlanFolder()}>
                          {UI_TEXT.buttons.openTaskPlanFolder}
                        </button>
                      </div>
                    </div>
                    <pre className="task-plan-markdown">{taskPlanMarkdown || UI_TEXT.empty.taskPlanMarkdown}</pre>
                  </>
                ) : (
                  <p className="empty-state">{UI_TEXT.empty.taskPlanMarkdown}</p>
                )}
              </div>
            </div>
              </>
            ) : null}
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
            </section>
            </section>
            {activeSessions.map((session) => {
              const isTerminalTabSelected = mainTab === `terminal:${session.sessionId}`;
              return (
                <section
                  className={`workspace-tab-pane workspace-terminal-pane ${isTerminalTabSelected ? "is-visible" : ""}`}
                  key={session.sessionId}
                >
                  <div className="panel-header workspace-terminal-header">
                    <div>
                      <h2>{session.profileName}</h2>
                      <span>{session.profileId}</span>
                    </div>
                    <div className="button-row">
                      {selectedSession?.sessionId === session.sessionId ? (
                        <>
                          <button type="button" onClick={() => void publishSelectedOutput()} disabled={!selectedSessionPreview}>
                            保存为结果
                          </button>
                          <button type="button" onClick={prepareForwardFromSelectedOutput} disabled={!selectedSessionPreview}>
                            转发最近输出
                          </button>
                          <button type="button" onClick={() => void stopSession(session.sessionId)}>
                            {UI_TEXT.buttons.stopSelected}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="terminal-host">
                    <TerminalPane
                      sessionId={session.sessionId}
                      onResize={(cols, rows) => resizeTerminal(session.sessionId, cols, rows)}
                    />
                  </div>
                </section>
              );
            })}
          </div>
        </section>

        {false ? (
          <aside className="legacy-terminal-stack">
            <section className="legacy-terminal-dock panel">
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
                    <button type="button" onClick={() => (selectedSession ? void stopSession(selectedSession.sessionId) : undefined)}>
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
        ) : null}
      </section>
      {isProfileEditorOpen ? (
        <section className="drawer-backdrop" role="presentation">
          <aside className="profile-drawer panel" aria-label={UI_TEXT.sections.profileEditor}>
            <div className="panel-header">
              <h2>{UI_TEXT.sections.profileEditor}</h2>
              <div className="button-row">
                <button type="button" onClick={() => void duplicateSelectedProfile()} disabled={!selectedProfile}>
                  {UI_TEXT.buttons.duplicate}
                </button>
                <button type="button" onClick={() => void deleteSelectedProfile()} disabled={!selectedProfile}>
                  {UI_TEXT.buttons.delete}
                </button>
                <button type="button" onClick={closeProfileEditor}>
                  关闭
                </button>
              </div>
            </div>
            <div className="profile-drawer-body">
              {selectedProfileOnlineCount > 0 ? (
                <p className="profile-editor-note">当前 Agent 已启动，保存后对后续发送任务生效；启动命令类改动需要重启该 Agent。</p>
              ) : null}
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
                  rows={9}
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
            </div>
            <div className="profile-drawer-actions">
              <button type="button" onClick={closeProfileEditor}>
                取消
              </button>
              <button type="button" onClick={() => void saveSelectedProfile()} disabled={!selectedProfile}>
                {UI_TEXT.buttons.saveProfile}
              </button>
            </div>
          </aside>
        </section>
      ) : null}
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
