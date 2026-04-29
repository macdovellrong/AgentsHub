import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type AgentProfileKind = "powershell" | "codex" | "claude" | "gemini" | "custom";

export type AgentProfile = {
  id: string;
  name: string;
  kind: AgentProfileKind;
  command: string;
  args: string[];
  aliases: string[];
  rolePrompt: string;
  env: Record<string, string>;
  defaultCwd: string | null;
  useWorkspaceWriteLock: boolean;
};

export type ProfileStoreOptions = {
  configPath: string;
};

export type CreateProfileInput = Omit<AgentProfile, "id"> & { id?: string };
export type UpdateProfileInput = Partial<Omit<AgentProfile, "id">>;

const DEFAULT_PROFILES: AgentProfile[] = [
  {
    id: "powershell",
    name: "PowerShell",
    kind: "powershell",
    command: "powershell.exe",
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NoExit",
      "-Command",
      "Remove-Module PSReadLine -ErrorAction SilentlyContinue; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; chcp 65001 | Out-Null; Write-Host 'AgentHub PowerShell ready'",
    ],
    aliases: ["ps"],
    rolePrompt: "",
    env: {},
    defaultCwd: null,
    useWorkspaceWriteLock: false,
  },
  {
    id: "codex",
    name: "Codex",
    kind: "codex",
    command: "codex.cmd",
    args: [],
    aliases: ["code"],
    rolePrompt: "Implement the requested change in the selected workspace.",
    env: {},
    defaultCwd: null,
    useWorkspaceWriteLock: true,
  },
  {
    id: "claude",
    name: "Claude",
    kind: "claude",
    command: "claude",
    args: [],
    aliases: [],
    rolePrompt: "Plan and decompose implementation work.",
    env: {},
    defaultCwd: null,
    useWorkspaceWriteLock: true,
  },
  {
    id: "gemini",
    name: "Gemini",
    kind: "gemini",
    command: "gemini.cmd",
    args: [],
    aliases: [],
    rolePrompt: "Review implementation output and identify risks.",
    env: {},
    defaultCwd: null,
    useWorkspaceWriteLock: false,
  },
];

export class ProfileStore {
  private readonly configPath: string;

  constructor(options: ProfileStoreOptions) {
    this.configPath = options.configPath;
  }

  async list(): Promise<AgentProfile[]> {
    return this.loadProfiles();
  }

  async get(id: string): Promise<AgentProfile | null> {
    return (await this.loadProfiles()).find((profile) => profile.id === id) ?? null;
  }

  async create(input: CreateProfileInput): Promise<AgentProfile> {
    const profiles = await this.loadProfiles();
    const profile = this.normalizeProfile({
      ...input,
      id: input.id ?? this.createProfileId(input.name),
    });
    if (profiles.some((existing) => existing.id === profile.id)) {
      throw new Error(`Profile already exists: ${profile.id}`);
    }
    profiles.push(profile);
    await this.saveProfiles(profiles);
    return profile;
  }

  async update(id: string, input: UpdateProfileInput): Promise<AgentProfile> {
    const profiles = await this.loadProfiles();
    const index = profiles.findIndex((profile) => profile.id === id);
    if (index < 0) {
      throw new Error(`Unknown profile: ${id}`);
    }
    const updated = this.normalizeProfile({ ...profiles[index], ...input, id });
    profiles[index] = updated;
    await this.saveProfiles(profiles);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const profiles = await this.loadProfiles();
    const next = profiles.filter((profile) => profile.id !== id);
    if (next.length === profiles.length) {
      throw new Error(`Unknown profile: ${id}`);
    }
    await this.saveProfiles(next);
  }

  async duplicate(id: string, overrides: Partial<Pick<AgentProfile, "id" | "name">> = {}): Promise<AgentProfile> {
    const profiles = await this.loadProfiles();
    const source = profiles.find((profile) => profile.id === id);
    if (!source) {
      throw new Error(`Unknown profile: ${id}`);
    }
    const duplicate = this.normalizeProfile({
      ...source,
      id: overrides.id ?? this.createProfileId(`${source.name} Copy`),
      name: overrides.name ?? `${source.name} Copy`,
    });
    if (profiles.some((profile) => profile.id === duplicate.id)) {
      throw new Error(`Profile already exists: ${duplicate.id}`);
    }
    profiles.push(duplicate);
    await this.saveProfiles(profiles);
    return duplicate;
  }

  private async loadProfiles(): Promise<AgentProfile[]> {
    try {
      const raw = await readFile(this.configPath, "utf8");
      const parsed = JSON.parse(raw) as { profiles?: AgentProfile[] };
      return (parsed.profiles ?? []).map((profile) => this.normalizeProfile(profile));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return DEFAULT_PROFILES.map((profile) => ({ ...profile, args: [...profile.args], aliases: [...profile.aliases], env: { ...profile.env } }));
      }
      throw error;
    }
  }

  private async saveProfiles(profiles: AgentProfile[]): Promise<void> {
    await mkdir(path.dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify({ profiles }, null, 2)}\n`, "utf8");
  }

  private normalizeProfile(profile: AgentProfile): AgentProfile {
    if (!profile.id || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(profile.id)) {
      throw new Error(`Invalid profile id: ${profile.id}`);
    }
    return {
      id: profile.id,
      name: profile.name,
      kind: profile.kind,
      command: profile.command,
      args: [...(profile.args ?? [])],
      aliases: [...(profile.aliases ?? [])],
      rolePrompt: profile.rolePrompt ?? "",
      env: { ...(profile.env ?? {}) },
      defaultCwd: profile.defaultCwd ?? null,
      useWorkspaceWriteLock: Boolean(profile.useWorkspaceWriteLock),
    };
  }

  private createProfileId(name: string): string {
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
    return `${slug || "profile"}-${randomUUID().slice(0, 8)}`;
  }
}

export function getDefaultProfiles(): AgentProfile[] {
  return DEFAULT_PROFILES.map((profile) => ({ ...profile, args: [...profile.args], aliases: [...profile.aliases], env: { ...profile.env } }));
}
