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
        var dispatchErrors = new List<AgentHubCommandDispatchError>();

        foreach (var command in parsed.SendMessages)
        {
            var sent = await messageRouter.TrySendToProfileAsync(
                workspacePath,
                command.To,
                command.Message,
                cancellationToken).ConfigureAwait(false);
            if (sent)
            {
                sentCount += 1;
            }
            else
            {
                dispatchErrors.Add(new AgentHubCommandDispatchError(
                    command.To,
                    $"No active session for profile '{command.To}' in workspace '{workspacePath}'."));
            }
        }

        return new AgentHubCommandDispatchResult(sentCount, parsed.Errors, dispatchErrors);
    }
}
