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
        var pairNegotiationCommands = new List<AgentHubPairNegotiationCommand>();
        var dispatchErrors = new List<AgentHubCommandDispatchError>();

        foreach (var command in parsed.SendMessages)
        {
            var dispatchMessage = FormatSendMessageDispatch(command);
            var result = await messageRouter.TrySendToProfileDetailedAsync(
                workspacePath,
                command.To,
                dispatchMessage,
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

        foreach (var command in parsed.PairNegotiationCommands)
        {
            var routedCommand = command;
            if (!string.IsNullOrWhiteSpace(command.MessageTo))
            {
                var dispatchMessage = FormatPairNegotiationDispatchMessage(command);
                routedCommand = command with { DispatchMessage = dispatchMessage };
                var result = await messageRouter.TrySendToProfileDetailedAsync(
                    workspacePath,
                    command.MessageTo,
                    dispatchMessage,
                    cancellationToken).ConfigureAwait(false);
                if (result.Sent)
                {
                    sentCount += 1;
                    routedCommand = routedCommand with { SessionId = result.SessionId };
                }
                else
                {
                    dispatchErrors.Add(new AgentHubCommandDispatchError(
                        command.MessageTo,
                        FormatSendFailure(workspacePath, command.MessageTo, result.Status),
                        PairNegotiationCommand: routedCommand));
                }
            }

            pairNegotiationCommands.Add(routedCommand);
        }

        return new AgentHubCommandDispatchResult(
            sentCount,
            sentMessages,
            parsed.PlanStatusCommands,
            parsed.TeamStatusCommands,
            parsed.WorkflowCommands,
            pairNegotiationCommands,
            parsed.Errors,
            dispatchErrors);
    }

    private static string FormatSendMessageDispatch(AgentHubSendMessageCommand command)
    {
        if (string.IsNullOrWhiteSpace(command.PlanId) ||
            string.IsNullOrWhiteSpace(command.TaskId) ||
            string.IsNullOrWhiteSpace(command.CommandAction))
        {
            return command.Message;
        }

        if (command.CommandAction == "request_review")
        {
            return string.Join(
                "\r\n",
                [
                    "AgentHub task-plan review request.",
                    $"Plan: {command.PlanId}",
                    $"Task: {command.TaskId}",
                    "",
                    command.Message,
                    "",
                    "Review the referenced task/artifact. When finished, rely on the configured AgentHub hook to return your review."
                ]);
        }

        return string.Join(
            "\r\n",
            [
                "AgentHub task-plan delegated task.",
                $"Plan: {command.PlanId}",
                $"Task: {command.TaskId}",
                "",
                command.Message,
                "",
                "When finished, rely on the configured AgentHub hook to return your final result. Keep the result focused on this task."
            ]);
    }

    private static string FormatPairNegotiationDispatchMessage(AgentHubPairNegotiationCommand command)
    {
        if (!string.IsNullOrWhiteSpace(command.Message))
        {
            return command.Message;
        }

        if (!string.IsNullOrWhiteSpace(command.Summary) &&
            !string.IsNullOrWhiteSpace(command.ArtifactPath))
        {
            return $"{command.Summary}\n\nArtifact: {command.ArtifactPath}";
        }

        if (!string.IsNullOrWhiteSpace(command.Summary))
        {
            return command.Summary;
        }

        if (!string.IsNullOrWhiteSpace(command.ArtifactPath))
        {
            return $"Please review artifact: {command.ArtifactPath}";
        }

        return $"Pair negotiation {command.Action} v{command.ProposalVersion:0.##}";
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
