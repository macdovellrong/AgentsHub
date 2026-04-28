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

export function findOnlineSessionForTarget(
  text: string,
  sessions: StartPowerShellResponse[],
  profiles: AgentProfileDto[],
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

  return sessions.find((session) => session.profileId === profile.id && session.status === "online") ?? null;
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
