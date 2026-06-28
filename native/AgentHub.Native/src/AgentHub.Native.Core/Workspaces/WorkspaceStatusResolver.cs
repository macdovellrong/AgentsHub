namespace AgentHub.Native.Core.Workspaces;

public static class WorkspaceStatusResolver
{
    public static string ResolveMissingWorkspaceStatus(string? currentStatus, string fallbackStatus)
    {
        return string.IsNullOrWhiteSpace(currentStatus)
            ? fallbackStatus
            : currentStatus;
    }
}
