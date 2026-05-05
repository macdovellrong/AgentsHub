import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type WorkspaceRecord = {
  path: string;
  name: string;
  lastOpenedAt: string;
  isActive: boolean;
};

type StoredWorkspace = Omit<WorkspaceRecord, "isActive">;

type WorkspaceConfig = {
  activeWorkspacePath?: string;
  workspaces?: StoredWorkspace[];
};

export type WorkspaceStoreOptions = {
  configPath: string;
  now?: () => Date;
};

export class WorkspaceStore {
  private readonly configPath: string;
  private readonly now: () => Date;

  constructor(options: WorkspaceStoreOptions) {
    this.configPath = options.configPath;
    this.now = options.now ?? (() => new Date());
  }

  async initialize(defaultWorkspacePath: string): Promise<{ activeWorkspacePath: string; workspaces: WorkspaceRecord[] }> {
    const config = await this.loadConfig();
    const activeWorkspacePath = config.activeWorkspacePath?.trim() || defaultWorkspacePath;
    const nextConfig = this.activateWorkspace({
      activeWorkspacePath,
      workspaces: config.workspaces ?? [],
    });
    await this.saveConfig(nextConfig);
    return this.toState(nextConfig);
  }

  async list(activeWorkspacePath: string): Promise<WorkspaceRecord[]> {
    const config = await this.loadConfig();
    return this.toState({
      activeWorkspacePath,
      workspaces: config.workspaces ?? [],
    }).workspaces;
  }

  async activate(workspacePath: string): Promise<{ activeWorkspacePath: string; workspaces: WorkspaceRecord[] }> {
    const config = await this.loadConfig();
    const nextConfig = this.activateWorkspace({
      activeWorkspacePath: workspacePath,
      workspaces: config.workspaces ?? [],
    });
    await this.saveConfig(nextConfig);
    return this.toState(nextConfig);
  }

  async remove(
    workspacePath: string,
    activeWorkspacePath: string,
  ): Promise<{ activeWorkspacePath: string; workspaces: WorkspaceRecord[] }> {
    const normalizedPath = this.normalizePath(workspacePath);
    if (normalizedPath === this.normalizePath(activeWorkspacePath)) {
      throw new Error("Cannot remove the active workspace");
    }

    const config = await this.loadConfig();
    const nextConfig: Required<WorkspaceConfig> = {
      activeWorkspacePath,
      workspaces: (config.workspaces ?? []).filter((workspace) => this.normalizePath(workspace.path) !== normalizedPath),
    };
    await this.saveConfig(nextConfig);
    return this.toState(nextConfig);
  }

  private upsertWorkspace(config: Required<WorkspaceConfig>, workspacePath: string): Required<WorkspaceConfig> {
    const normalizedPath = this.normalizePath(workspacePath);
    const nextWorkspace: StoredWorkspace = {
      path: workspacePath,
      name: this.workspaceName(workspacePath),
      lastOpenedAt: this.now().toISOString(),
    };
    const workspaces = [
      nextWorkspace,
      ...config.workspaces.filter((workspace) => this.normalizePath(workspace.path) !== normalizedPath),
    ];
    return {
      activeWorkspacePath: workspacePath,
      workspaces,
    };
  }

  private activateWorkspace(config: Required<WorkspaceConfig>): Required<WorkspaceConfig> {
    const normalizedPath = this.normalizePath(config.activeWorkspacePath);
    if (config.workspaces.some((workspace) => this.normalizePath(workspace.path) === normalizedPath)) {
      return config;
    }
    return this.upsertWorkspace(config, config.activeWorkspacePath);
  }

  private toState(config: Required<WorkspaceConfig>): { activeWorkspacePath: string; workspaces: WorkspaceRecord[] } {
    const activeNormalizedPath = this.normalizePath(config.activeWorkspacePath);
    const workspaces = [...config.workspaces]
      .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt))
      .map((workspace) => ({
        ...workspace,
        isActive: this.normalizePath(workspace.path) === activeNormalizedPath,
      }));
    return { activeWorkspacePath: config.activeWorkspacePath, workspaces };
  }

  private async loadConfig(): Promise<WorkspaceConfig> {
    try {
      const raw = await readFile(this.configPath, "utf8");
      const parsed = JSON.parse(raw) as WorkspaceConfig;
      return {
        activeWorkspacePath: typeof parsed.activeWorkspacePath === "string" ? parsed.activeWorkspacePath : undefined,
        workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces.filter((workspace) => this.isStoredWorkspace(workspace)) : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      if (error instanceof SyntaxError) {
        return {};
      }
      throw error;
    }
  }

  private async saveConfig(config: Required<WorkspaceConfig>): Promise<void> {
    await mkdir(path.dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  private isStoredWorkspace(value: unknown): value is StoredWorkspace {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.path === "string" &&
      typeof candidate.name === "string" &&
      typeof candidate.lastOpenedAt === "string"
    );
  }

  private workspaceName(workspacePath: string): string {
    return path.basename(workspacePath.replace(/[\\/]+$/g, "")) || workspacePath;
  }

  private normalizePath(workspacePath: string): string {
    return path.resolve(workspacePath).replace(/[\\/]+$/g, "").toLowerCase();
  }
}
