import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

type LoadedWorkspaceConfig = {
  config: WorkspaceConfig;
  needsRepair: boolean;
};

export type WorkspaceStoreOptions = {
  configPath: string;
  now?: () => Date;
};

export class WorkspaceStore {
  private readonly configPath: string;
  private readonly now: () => Date;
  private operationTail = Promise.resolve();

  constructor(options: WorkspaceStoreOptions) {
    this.configPath = options.configPath;
    this.now = options.now ?? (() => new Date());
  }

  async initialize(defaultWorkspacePath: string): Promise<{ activeWorkspacePath: string; workspaces: WorkspaceRecord[] }> {
    return this.runExclusive(async () => {
      const loaded = await this.loadConfig();
      const activeWorkspacePath = loaded.config.activeWorkspacePath?.trim() || defaultWorkspacePath;
      const currentConfig: Required<WorkspaceConfig> = {
        activeWorkspacePath,
        workspaces: loaded.config.workspaces ?? [],
      };
      const nextConfig = this.activateWorkspace(currentConfig);
      if (loaded.needsRepair || !this.configsEqual(currentConfig, nextConfig)) {
        await this.saveConfig(nextConfig);
      }
      return this.toState(nextConfig);
    });
  }

  async list(activeWorkspacePath: string): Promise<WorkspaceRecord[]> {
    return this.runExclusive(async () => {
      const loaded = await this.loadConfig();
      return this.toState({
        activeWorkspacePath,
        workspaces: loaded.config.workspaces ?? [],
      }).workspaces;
    });
  }

  async activate(workspacePath: string): Promise<{ activeWorkspacePath: string; workspaces: WorkspaceRecord[] }> {
    return this.runExclusive(async () => {
      const loaded = await this.loadConfig();
      const nextConfig = this.activateWorkspace({
        activeWorkspacePath: workspacePath,
        workspaces: loaded.config.workspaces ?? [],
      });
      await this.saveConfig(nextConfig);
      return this.toState(nextConfig);
    });
  }

  async remove(
    workspacePath: string,
    activeWorkspacePath: string,
  ): Promise<{ activeWorkspacePath: string; workspaces: WorkspaceRecord[] }> {
    return this.runExclusive(async () => {
      const normalizedPath = this.normalizePath(workspacePath);
      if (normalizedPath === this.normalizePath(activeWorkspacePath)) {
        throw new Error("Cannot remove the active workspace");
      }

      const loaded = await this.loadConfig();
      const nextConfig: Required<WorkspaceConfig> = {
        activeWorkspacePath,
        workspaces: (loaded.config.workspaces ?? []).filter(
          (workspace) => this.normalizePath(workspace.path) !== normalizedPath,
        ),
      };
      await this.saveConfig(nextConfig);
      return this.toState(nextConfig);
    });
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

  private async loadConfig(): Promise<LoadedWorkspaceConfig> {
    try {
      return { config: await this.loadConfigFile(this.configPath), needsRepair: false };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { config: {}, needsRepair: true };
      }
      if (error instanceof SyntaxError) {
        return this.loadBackupConfig();
      }
      throw error;
    }
  }

  private async saveConfig(config: Required<WorkspaceConfig>): Promise<void> {
    await mkdir(path.dirname(this.configPath), { recursive: true });
    await this.backupCurrentConfigIfValid();
    const temporaryPath = `${this.configPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      await this.replaceConfigFile(temporaryPath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private async loadBackupConfig(): Promise<LoadedWorkspaceConfig> {
    try {
      return { config: await this.loadConfigFile(this.backupConfigPath()), needsRepair: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
        return { config: {}, needsRepair: true };
      }
      throw error;
    }
  }

  private async backupCurrentConfigIfValid(): Promise<void> {
    try {
      await this.loadConfigFile(this.configPath);
      await copyFile(this.configPath, this.backupConfigPath());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
        return;
      }
      throw error;
    }
  }

  private async loadConfigFile(configPath: string): Promise<WorkspaceConfig> {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as WorkspaceConfig;
    return {
      activeWorkspacePath: typeof parsed.activeWorkspacePath === "string" ? parsed.activeWorkspacePath : undefined,
      workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces.filter((workspace) => this.isStoredWorkspace(workspace)) : [],
    };
  }

  private async replaceConfigFile(temporaryPath: string): Promise<void> {
    const retryDelaysMs = [25, 75, 150];
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      try {
        await rename(temporaryPath, this.configPath);
        return;
      } catch (error) {
        if (!this.isRetryableReplaceError(error) || attempt === retryDelaysMs.length) {
          break;
        }
        await this.delay(retryDelaysMs[attempt]);
      }
    }

    await copyFile(temporaryPath, this.configPath);
    await rm(temporaryPath, { force: true });
  }

  private isRetryableReplaceError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM" || code === "EACCES" || code === "EBUSY";
  }

  private delay(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  private backupConfigPath(): string {
    return `${this.configPath}.bak`;
  }

  private configsEqual(left: Required<WorkspaceConfig>, right: Required<WorkspaceConfig>): boolean {
    return (
      left.activeWorkspacePath === right.activeWorkspacePath &&
      left.workspaces.length === right.workspaces.length &&
      left.workspaces.every((workspace, index) => {
        const rightWorkspace = right.workspaces[index];
        return (
          rightWorkspace !== undefined &&
          workspace.path === rightWorkspace.path &&
          workspace.name === rightWorkspace.name &&
          workspace.lastOpenedAt === rightWorkspace.lastOpenedAt
        );
      })
    );
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationTail.catch(() => undefined).then(operation);
    this.operationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
