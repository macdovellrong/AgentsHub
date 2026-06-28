namespace AgentHub.Native.Core.Collaboration;

public static class AgentSessionDisplayFormatter
{
    public static string Format(AgentSessionDescriptor session)
    {
        ArgumentNullException.ThrowIfNull(session);
        var runId = string.IsNullOrWhiteSpace(session.RunId) ? "untracked" : session.RunId;
        var hookReceiverUrl = string.IsNullOrWhiteSpace(session.HookReceiverUrl) ? "unavailable" : session.HookReceiverUrl;
        return $"{session.Id} | profile={session.ProfileId} | workspace={session.WorkspacePath} | run={runId} | hook={hookReceiverUrl}";
    }
}
