namespace AgentHub.Native.Core.Collaboration;

public sealed class AgentSessionRegistry
{
    private readonly Dictionary<string, AgentSessionDescriptor> sessions = new(StringComparer.OrdinalIgnoreCase);

    public void Register(AgentSessionDescriptor session)
    {
        ArgumentNullException.ThrowIfNull(session);
        sessions[session.Id] = session;
    }

    public void Remove(string sessionId)
    {
        sessions.Remove(sessionId);
    }

    public void Clear()
    {
        sessions.Clear();
    }

    public AgentSessionDescriptor? FindLatest(string workspacePath, string profileId)
    {
        var normalizedWorkspace = NormalizePath(workspacePath);
        return sessions.Values
            .Where(session =>
                string.Equals(NormalizePath(session.WorkspacePath), normalizedWorkspace, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(session.ProfileId, profileId, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(session => session.StartedAt)
            .FirstOrDefault();
    }

    private static string NormalizePath(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        return path.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }
}
