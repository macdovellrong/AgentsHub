import type { AgentProfileDto, CreateProfileRequest, StartPowerShellResponse } from "../../shared/ipc";

export type ProfileEditorFields = {
  name: string;
  command: string;
  argsText: string;
  aliasesText: string;
  rolePrompt: string;
  useWorkspaceWriteLock: boolean;
};

export function splitListInput(value: string): string[] {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildProfileSavePayload(
  profile: AgentProfileDto,
  fields: ProfileEditorFields,
): Omit<CreateProfileRequest, "id"> {
  return {
    kind: profile.kind,
    name: fields.name.trim(),
    command: fields.command.trim(),
    args: splitListInput(fields.argsText),
    aliases: splitListInput(fields.aliasesText),
    rolePrompt: fields.rolePrompt,
    env: { ...profile.env },
    defaultCwd: profile.defaultCwd,
    useWorkspaceWriteLock: fields.useWorkspaceWriteLock,
  };
}

export function profileToFields(profile: AgentProfileDto): ProfileEditorFields {
  return {
    name: profile.name,
    command: profile.command,
    argsText: profile.args.join("\n"),
    aliasesText: profile.aliases.join(" "),
    rolePrompt: profile.rolePrompt,
    useWorkspaceWriteLock: profile.useWorkspaceWriteLock,
  };
}

export function getInputTargetToken(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("@")) {
    return null;
  }
  return trimmed.split(/\s+/, 1)[0].toLowerCase();
}

export function normalizeWorkspacePath(workspacePath: string | undefined): string | null {
  const trimmed = workspacePath?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/[\\/]+$/g, "").replace(/\\/g, "/").toLowerCase();
}

export function isSessionInWorkspace(session: StartPowerShellResponse, workspacePath: string | undefined): boolean {
  const targetWorkspace = normalizeWorkspacePath(workspacePath);
  if (!targetWorkspace) {
    return true;
  }
  return normalizeWorkspacePath(session.workspacePath) === targetWorkspace;
}

export function filterSessionsForWorkspace(
  sessions: StartPowerShellResponse[],
  workspacePath: string | undefined,
): StartPowerShellResponse[] {
  return sessions.filter((session) => session.status === "online" && isSessionInWorkspace(session, workspacePath));
}

export function countOnlineSessionsForWorkspace(
  sessions: StartPowerShellResponse[],
  workspacePath: string | undefined,
): number {
  return filterSessionsForWorkspace(sessions, workspacePath).length;
}

export function findOnlineSessionForProfile(
  profileId: string,
  sessions: StartPowerShellResponse[],
  workspacePath?: string,
): StartPowerShellResponse | null {
  return (
    sessions.find(
      (session) =>
        session.profileId === profileId && session.status === "online" && isSessionInWorkspace(session, workspacePath),
    ) ?? null
  );
}

export function findOnlineSessionForTarget(
  text: string,
  sessions: StartPowerShellResponse[],
  profiles: AgentProfileDto[],
  workspacePath?: string,
): StartPowerShellResponse | null {
  const targetToken = getInputTargetToken(text);

  if (!targetToken) {
    return null;
  }

  const profile = profiles.find((candidate) => {
    const aliases = candidate.aliases.map((alias) => alias.toLowerCase());
    return `@${candidate.id.toLowerCase()}` === targetToken || aliases.includes(targetToken);
  });

  if (!profile) {
    return null;
  }

  return findOnlineSessionForProfile(profile.id, sessions, workspacePath);
}

export function buildRoutedTerminalMessage(profile: AgentProfileDto | undefined, message: string): string {
  const rolePrompt = profile?.rolePrompt.trim();
  if (!rolePrompt) {
    return message;
  }
  return [
    "AgentHub profile instructions:",
    rolePrompt,
    "",
    "User message:",
    message,
  ].join("\r\n");
}

export function pickSelectedSessionId(
  currentSessionId: string | null,
  sessions: StartPowerShellResponse[],
): string | null {
  if (currentSessionId && sessions.some((session) => session.sessionId === currentSessionId)) {
    return currentSessionId;
  }

  return sessions[0]?.sessionId ?? null;
}

export function appendTerminalPreview(current: string, chunk: string, maxLength = 4000): string {
  const withoutAnsi = chunk
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
  const normalized = withoutAnsi.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const combined = `${current}${normalized}`;
  return combined.length > maxLength ? combined.slice(combined.length - maxLength) : combined;
}
