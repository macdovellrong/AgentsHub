import { existsSync } from "node:fs";
import path from "node:path";

export function resolveWorkspacePath(requestedPath: string | undefined, fallbackPath: string): string {
  const trimmedPath = requestedPath?.trim();
  if (trimmedPath) {
    return trimmedPath;
  }
  return fallbackPath;
}

export function getDefaultWorkspacePath(currentWorkingDirectory: string, configuredWorkspace?: string): string {
  const trimmedConfiguredWorkspace = configuredWorkspace?.trim();
  if (trimmedConfiguredWorkspace) {
    return trimmedConfiguredWorkspace;
  }

  const parentDirectory = path.dirname(currentWorkingDirectory);
  const startsFromDesktopPackage = path.basename(currentWorkingDirectory).toLowerCase() === "desktop";
  if (
    startsFromDesktopPackage &&
    (existsSync(path.join(parentDirectory, "AGENTS.md")) || existsSync(path.join(parentDirectory, ".git")))
  ) {
    return parentDirectory;
  }

  return currentWorkingDirectory;
}
