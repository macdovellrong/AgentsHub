using AgentHub.Native.Core.Input;

namespace AgentHub.Native.Core.Collaboration;

public sealed class AgentMessageRouter(AgentInputRouter inputRouter, AgentSessionRegistry sessionRegistry)
{
    public async Task SendToProfileAsync(
        string workspacePath,
        string profileId,
        string message,
        CancellationToken cancellationToken = default)
    {
        var sent = await TrySendToProfileAsync(workspacePath, profileId, message, cancellationToken).ConfigureAwait(false);
        if (!sent)
        {
            throw new KeyNotFoundException($"No active session for profile '{profileId}' in workspace '{workspacePath}'.");
        }
    }

    public async Task<bool> TrySendToProfileAsync(
        string workspacePath,
        string profileId,
        string message,
        CancellationToken cancellationToken = default)
    {
        var session = sessionRegistry.FindLatest(workspacePath, profileId);
        if (session is null)
        {
            return false;
        }

        await inputRouter.SendLineAsync(session.Id, message, cancellationToken).ConfigureAwait(false);
        return true;
    }
}
