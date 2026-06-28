namespace AgentHub.Native.Core.Profiles;

public static class AgentStartupStatusFormatter
{
    public static string FormatFailure(AgentKind agentKind, Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        var reason = string.IsNullOrWhiteSpace(exception.Message)
            ? exception.GetType().Name
            : exception.Message;
        return $"Failed to start {agentKind}: {reason}";
    }
}
