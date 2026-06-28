using AgentHub.Native.Core.Input;

namespace AgentHub.Native.Core.Collaboration;

public sealed class AgentMessageRouter(AgentInputRouter inputRouter, AgentSessionRegistry sessionRegistry)
{
    public Task SendToProfileAsync(
        string workspacePath,
        string profileId,
        string message,
        CancellationToken cancellationToken = default)
    {
        var session = sessionRegistry.FindLatest(workspacePath, profileId);
        if (session is null)
        {
            throw new KeyNotFoundException($"No active session for profile '{profileId}' in workspace '{workspacePath}'.");
        }

        return inputRouter.SendLineAsync(session.Id, message, cancellationToken);
    }
}
