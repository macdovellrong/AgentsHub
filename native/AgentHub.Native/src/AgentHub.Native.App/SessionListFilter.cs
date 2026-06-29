using System.IO;

namespace AgentHub.Native.App;

public static class SessionListFilter
{
    public static IReadOnlyList<TSession> Filter<TSession>(
        IEnumerable<TSession> sessions,
        string? currentWorkspacePath,
        bool currentWorkspaceOnly,
        Func<TSession, string> workspacePathSelector)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        ArgumentNullException.ThrowIfNull(workspacePathSelector);

        var items = sessions.ToArray();
        if (!currentWorkspaceOnly || string.IsNullOrWhiteSpace(currentWorkspacePath))
        {
            return items;
        }

        var normalizedCurrent = NormalizeWorkspacePath(currentWorkspacePath);
        return items
            .Where(session => string.Equals(
                NormalizeWorkspacePath(workspacePathSelector(session)),
                normalizedCurrent,
                StringComparison.OrdinalIgnoreCase))
            .ToArray();
    }

    private static string NormalizeWorkspacePath(string workspacePath)
    {
        return workspacePath.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }
}
