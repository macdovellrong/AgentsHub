using AgentHub.Native.Core.Hooks;

namespace AgentHub.Native.Core.Collaboration;

public sealed class AgentHookEventProcessor(
    CollaborationEventStore eventStore,
    AgentHubCommandDispatcher commandDispatcher,
    AgentTeamStore? teamStore = null,
    AgentTaskStore? taskStore = null,
    AgentTaskPlanEventStore? taskPlanEventStore = null)
{
    public async Task<AgentHubCommandDispatchResult> ProcessAsync(
        AgentHookEvent hookEvent,
        CancellationToken cancellationToken = default)
    {
        var agentOutputEvent = await eventStore.AppendAgentOutputAsync(hookEvent, cancellationToken).ConfigureAwait(false);
        var fromProfileId = hookEvent.ProfileId ?? hookEvent.Source ?? "agent";
        var dispatchResult = await commandDispatcher.DispatchAsync(
            hookEvent.Workspace,
            hookEvent.Message,
            fromProfileId,
            cancellationToken).ConfigureAwait(false);
        await eventStore.AppendForwardedAgentHubCommandsAsync(
            hookEvent.Workspace,
            dispatchResult,
            cancellationToken).ConfigureAwait(false);
        await RecordTeamMailboxAsync(hookEvent, dispatchResult, cancellationToken).ConfigureAwait(false);
        await RecordTaskStatusAsync(hookEvent, dispatchResult, cancellationToken).ConfigureAwait(false);
        await RecordTaskPlanEventsAsync(hookEvent, dispatchResult, agentOutputEvent.Id, cancellationToken).ConfigureAwait(false);
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
                    null,
                    message.PlanId),
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
                    error.Message,
                    error.Command.PlanId),
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

        foreach (var command in dispatchResult.PairNegotiationCommands)
        {
            if (string.IsNullOrWhiteSpace(command.MessageTo) ||
                string.IsNullOrWhiteSpace(command.DispatchMessage) ||
                string.IsNullOrWhiteSpace(command.SessionId))
            {
                continue;
            }

            await store.AppendMailboxAsync(
                hookEvent.Workspace,
                new AgentTeamMailboxRequest(
                    "default",
                    command.Action,
                    fromProfileId,
                    command.MessageTo,
                    command.DispatchMessage,
                    null,
                    null,
                    "sent",
                    command.SessionId,
                    null),
                cancellationToken).ConfigureAwait(false);
        }

        foreach (var error in dispatchResult.DispatchErrors)
        {
            if (error.PairNegotiationCommand is null ||
                string.IsNullOrWhiteSpace(error.PairNegotiationCommand.MessageTo) ||
                string.IsNullOrWhiteSpace(error.PairNegotiationCommand.DispatchMessage))
            {
                continue;
            }

            await store.AppendMailboxAsync(
                hookEvent.Workspace,
                new AgentTeamMailboxRequest(
                    "default",
                    error.PairNegotiationCommand.Action,
                    fromProfileId,
                    error.PairNegotiationCommand.MessageTo,
                    error.PairNegotiationCommand.DispatchMessage,
                    null,
                    null,
                    "failed",
                    null,
                    error.Message),
                cancellationToken).ConfigureAwait(false);
        }
    }

    private static string TeamIdOrDefault(string? teamId)
    {
        return string.IsNullOrWhiteSpace(teamId) ? "default" : teamId;
    }

    private async Task RecordTaskStatusAsync(
        AgentHookEvent hookEvent,
        AgentHubCommandDispatchResult dispatchResult,
        CancellationToken cancellationToken)
    {
        if (taskStore is null)
        {
            return;
        }

        var profileId = hookEvent.ProfileId ?? hookEvent.Source;
        foreach (var command in dispatchResult.TeamStatusCommands)
        {
            var status = command.Action switch
            {
                "claim_task" => "running",
                "complete_task" => "done",
                _ => null
            };
            if (status is null)
            {
                continue;
            }

            try
            {
                await taskStore.UpdateAsync(
                    hookEvent.Workspace,
                    command.TaskId,
                    new AgentTaskUpdateRequest(
                        Status: status,
                        ProfileId: profileId,
                        RunId: hookEvent.RunId),
                    cancellationToken).ConfigureAwait(false);
            }
            catch (InvalidOperationException)
            {
                // Team status commands may refer to task-plan ids rather than legacy task-board ids.
            }
        }
    }

    private async Task RecordTaskPlanEventsAsync(
        AgentHookEvent hookEvent,
        AgentHubCommandDispatchResult dispatchResult,
        string sourceEventId,
        CancellationToken cancellationToken)
    {
        if (taskPlanEventStore is null)
        {
            return;
        }

        var fromProfileId = hookEvent.ProfileId ?? hookEvent.Source;
        foreach (var command in dispatchResult.SentMessages)
        {
            if (string.IsNullOrWhiteSpace(command.PlanId) ||
                string.IsNullOrWhiteSpace(command.CommandAction))
            {
                continue;
            }

            await taskPlanEventStore.AppendEventAsync(
                hookEvent.Workspace,
                new AgentTaskPlanEventRequest(
                    command.PlanId,
                    TaskPlanEventType(command.CommandAction),
                    command.TaskId,
                    fromProfileId,
                    command.To,
                    command.Message,
                    command.SessionId,
                    hookEvent.RunId,
                    sourceEventId),
                cancellationToken).ConfigureAwait(false);
        }

        foreach (var error in dispatchResult.DispatchErrors)
        {
            if (error.Command is null ||
                string.IsNullOrWhiteSpace(error.Command.PlanId) ||
                string.IsNullOrWhiteSpace(error.Command.CommandAction))
            {
                continue;
            }

            await taskPlanEventStore.AppendEventAsync(
                hookEvent.Workspace,
                new AgentTaskPlanEventRequest(
                    error.Command.PlanId,
                    "delivery_failed",
                    error.Command.TaskId,
                    fromProfileId,
                    error.Command.To,
                    error.Message,
                    hookEvent.SessionId,
                    hookEvent.RunId,
                    sourceEventId),
                cancellationToken).ConfigureAwait(false);
        }

        foreach (var command in dispatchResult.PlanStatusCommands)
        {
            await taskPlanEventStore.AppendEventAsync(
                hookEvent.Workspace,
                new AgentTaskPlanEventRequest(
                    command.PlanId,
                    TaskPlanEventType(command.Action),
                    command.TaskId,
                    fromProfileId,
                    null,
                    command.Message,
                    hookEvent.SessionId,
                    hookEvent.RunId,
                    sourceEventId),
                cancellationToken).ConfigureAwait(false);
        }
    }

    private static string TaskPlanEventType(string action)
    {
        return action switch
        {
            "assign_task" => "assigned",
            "request_review" => "review_requested",
            "reject_task" => "rejected",
            "approve_task" => "approved",
            "pause_plan" => "paused",
            _ => action
        };
    }
}
