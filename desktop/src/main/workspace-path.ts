export function resolveWorkspacePath(requestedPath: string | undefined, fallbackPath: string): string {
  if (requestedPath?.trim()) {
    return requestedPath;
  }
  return fallbackPath;
}
