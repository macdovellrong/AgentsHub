namespace AgentHub.Native.Core.Workspaces;

public static class WorkspaceDirectoryValidator
{
    public static WorkspaceDirectoryValidationResult Validate(string? workspacePath)
    {
        var normalizedPath = WorkspacePathSelection.NormalizeSelectedPath(workspacePath);
        if (normalizedPath is null)
        {
            return new WorkspaceDirectoryValidationResult(
                false,
                null,
                "Select a workspace directory first.");
        }

        if (!Directory.Exists(normalizedPath))
        {
            return new WorkspaceDirectoryValidationResult(
                false,
                null,
                $"Workspace directory does not exist: {normalizedPath}");
        }

        return new WorkspaceDirectoryValidationResult(true, normalizedPath, null);
    }
}
