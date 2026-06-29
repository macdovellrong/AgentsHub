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
        var result = await TrySendToProfileDetailedAsync(
            workspacePath,
            profileId,
            message,
            cancellationToken).ConfigureAwait(false);
        return result.Sent;
    }

    public async Task<AgentMessageSendResult> TrySendToProfileDetailedAsync(
        string workspacePath,
        string profileId,
        string message,
        CancellationToken cancellationToken = default)
    {
        var session = sessionRegistry.FindLatest(workspacePath, profileId);
        if (session is null)
        {
            return new AgentMessageSendResult(AgentMessageSendStatus.ProfileOffline);
        }

        var result = await inputRouter.TrySendLineDetailedAsync(session.Id, message, cancellationToken).ConfigureAwait(false);
        if (!result.Sent)
        {
            if (result.ShouldRemoveSession)
            {
                sessionRegistry.Remove(session.Id);
            }

            return AgentMessageSendResult.FromInputResult(result, session.Id);
        }

        return new AgentMessageSendResult(AgentMessageSendStatus.Sent, session.Id);
    }
}
