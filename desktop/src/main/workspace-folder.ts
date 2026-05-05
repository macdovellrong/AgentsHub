export type OpenWorkspacePath = (workspacePath: string) => Promise<string>;

export async function openWorkspaceFolderPath(
  workspacePath: string,
  openPath: OpenWorkspacePath,
): Promise<void> {
  const errorMessage = await openPath(workspacePath);
  if (errorMessage) {
    throw new Error(errorMessage);
  }
}
