using AgentHub.Native.Core.Hooks;

namespace AgentHub.Native.Core.Collaboration;

public sealed class AgentHookEventProcessor(
    CollaborationEventStore eventStore,
    AgentHubCommandDispatcher commandDispatcher,
    AgentTeamStore? teamStore = null)
{
    public async Task<AgentHubCommandDispatchResult> ProcessAsync(
        AgentHookEvent hookEvent,
        CancellationToken cancellationToken = default)
    {
        await eventStore.AppendAgentOutputAsync(hookEvent, cancellationToken).ConfigureAwait(false);
        var dispatchResult = await commandDispatcher.DispatchAsync(
            hookEvent.Workspace,
            hookEvent.Message,
            cancellationToken).ConfigureAwait(false);
        await eventStore.AppendForwardedAgentHubCommandsAsync(
            hookEvent.Workspace,
            dispatchResult,
            cancellationToken).ConfigureAwait(false);
        await RecordTeamMailboxAsync(hookEvent, dispatchResult, cancellationToken).ConfigureAwait(false);
        return dispatchResult;
    }

    private async Task RecordTeamMailboxAsync(
        AgentHookEvent hookEvent,
        AgentHubCommandDispatchResult dispatchResult,
        CancellationToken cancellationToken)
    {
        var store = teamStore ?? new AgentTeamStore();
        var fromProfileId = hookEvent.ProfileId ?? hookEvent.Source ?? "agent";
        foreach (var message in dispatchResult.SentMessages)
        {
            await store.AppendMailboxAsync(
                hookEvent.Workspace,
                new AgentTeamMailboxRequest(
                    TeamIdOrDefault(message.TeamId),
                    "send_message",
                    fromProfileId,
                    message.To,
                    message.Message,
                    message.TaskId,
                    message.ConversationId,
                    "sent",
                    message.SessionId,
                    null),
                cancellationToken).ConfigureAwait(false);
        }

        foreach (var error in dispatchResult.DispatchErrors)
        {
            if (error.Command is null)
            {
                continue;
            }

            await store.AppendMailboxAsync(
                hookEvent.Workspace,
                new AgentTeamMailboxRequest(
                    TeamIdOrDefault(error.Command.TeamId),
                    "send_message",
                    fromProfileId,
                    error.Command.To,
                    error.Command.Message,
                    error.Command.TaskId,
                    error.Command.ConversationId,
                    "failed",
                    null,
                    error.Message),
                cancellationToken).ConfigureAwait(false);
        }

        foreach (var command in dispatchResult.TeamStatusCommands)
        {
            await store.AppendMailboxAsync(
                hookEvent.Workspace,
                new AgentTeamMailboxRequest(
                    command.TeamId,
                    command.Action,
                    fromProfileId,
                    null,
                    command.Summary ?? (command.Action == "claim_task" ? "Task claimed" : "Task completed"),
                    command.TaskId,
                    null,
                    "observed",
                    null,
                    null),
                cancellationToken).ConfigureAwait(false);
        }
    }

    private static string TeamIdOrDefault(string? teamId)
    {
        return string.IsNullOrWhiteSpace(teamId) ? "default" : teamId;
    }
}
