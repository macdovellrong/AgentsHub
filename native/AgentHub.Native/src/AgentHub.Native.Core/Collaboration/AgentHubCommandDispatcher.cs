namespace AgentHub.Native.Core.Collaboration;

public sealed class AgentHubCommandDispatcher(AgentMessageRouter messageRouter)
{
    public async Task<AgentHubCommandDispatchResult> DispatchAsync(
        string workspacePath,
        string text,
        CancellationToken cancellationToken = default)
    {
        var parsed = AgentHubCommandParser.Parse(text);
        var sentCount = 0;
        var sentMessages = new List<AgentHubSendMessageCommand>();
        var dispatchErrors = new List<AgentHubCommandDispatchError>();

        foreach (var command in parsed.SendMessages)
        {
            var result = await messageRouter.TrySendToProfileDetailedAsync(
                workspacePath,
                command.To,
                command.Message,
                cancellationToken).ConfigureAwait(false);
            if (result.Sent)
            {
                sentCount += 1;
                sentMessages.Add(command with { SessionId = result.SessionId });
            }
            else
            {
                dispatchErrors.Add(new AgentHubCommandDispatchError(
                    command.To,
                    FormatSendFailure(workspacePath, command.To, result.Status),
                    command));
            }
        }

        return new AgentHubCommandDispatchResult(
            sentCount,
            sentMessages,
            parsed.PlanStatusCommands,
            parsed.TeamStatusCommands,
            parsed.Errors,
            dispatchErrors);
    }

    private static string FormatSendFailure(
        string workspacePath,
        string profileId,
        AgentMessageSendStatus status)
    {
        return status switch
        {
            AgentMessageSendStatus.TerminalNotReady =>
                $"Session for profile '{profileId}' in workspace '{workspacePath}' is still starting.",
            AgentMessageSendStatus.TerminalUnavailable =>
                $"Terminal session for profile '{profileId}' in workspace '{workspacePath}' is unavailable.",
            _ => $"No active session for profile '{profileId}' in workspace '{workspacePath}'."
        };
    }
}
