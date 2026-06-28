namespace AgentHub.Native.Core.Workspaces;

public static class WorkspacePathSelection
{
    public static string? NormalizeSelectedPath(string? selectedPath)
    {
        if (string.IsNullOrWhiteSpace(selectedPath))
        {
            return null;
        }

        return selectedPath.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }
}
