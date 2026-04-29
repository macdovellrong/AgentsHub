export type WorkspaceDialogResult = {
  canceled: boolean;
  filePaths: string[];
};

export type WorkspaceDialogChooser = (currentWorkspacePath: string) => Promise<WorkspaceDialogResult>;

export async function selectWorkspacePath(
  currentWorkspacePath: string,
  choose: WorkspaceDialogChooser,
): Promise<string> {
  const result = await choose(currentWorkspacePath);
  if (result.canceled || !result.filePaths[0]) {
    return currentWorkspacePath;
  }
  return result.filePaths[0];
}
