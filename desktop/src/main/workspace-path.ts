export function resolveWorkspacePath(requestedPath: string | undefined, fallbackPath: string): string {
  const trimmedPath = requestedPath?.trim();
  if (trimmedPath) {
    return trimmedPath;
  }
  return fallbackPath;
}
