using AgentHub.Native.Core.Collaboration;
using AgentHub.Native.Core.Input;

namespace AgentHub.Native.Core.TaskPlans;

public sealed class AgentTaskPlanService(
    AgentTaskPlanStore store,
    CollaborationEventStore timelineStore,
    AgentInputRouter inputRouter,
    AgentSessionRegistry sessionRegistry)
{
    public async Task<AgentTaskPlan> CreatePlanAsync(
        string workspacePath,
        CreateAgentTaskPlanRequest request,
        CancellationToken cancellationToken = default)
    {
        var plan = await store.CreatePlanAsync(workspacePath, request, cancellationToken).ConfigureAwait(false);
        await store.AppendEventAsync(
            workspacePath,
            plan.Id,
            new AgentTaskPlanLogEventInput(
                "created",
                Message: plan.Title,
                ToProfileId: plan.ManagerProfileId),
            cancellationToken).ConfigureAwait(false);
        return plan;
    }

    public async Task<AgentTaskPlan> StartManagerAsync(
        string workspacePath,
        string planId,
        CancellationToken cancellationToken = default)
    {
        var plan = await store.GetPlanAsync(workspacePath, planId, cancellationToken).ConfigureAwait(false);
        var managerSession = sessionRegistry.FindLatest(workspacePath, plan.ManagerProfileId);
        if (managerSession is null)
        {
            await RecordDeliveryFailureAsync(
                workspacePath,
                plan,
                plan.ManagerProfileId,
                $"No active session for profile '{plan.ManagerProfileId}'",
                cancellationToken).ConfigureAwait(false);
            return plan;
        }

        var prompt = BuildManagerPrompt(plan);
        var sendResult = await inputRouter.TrySendLineDetailedAsync(managerSession.Id, prompt, cancellationToken)
            .ConfigureAwait(false);
        if (!sendResult.Sent)
        {
            if (sendResult.ShouldRemoveSession)
            {
                sessionRegistry.Remove(managerSession.Id);
            }

            await RecordDeliveryFailureAsync(
                workspacePath,
                plan,
                plan.ManagerProfileId,
                $"Unable to send task-plan manager prompt to session '{managerSession.Id}': {sendResult.Status}",
                cancellationToken).ConfigureAwait(false);
            return plan;
        }

        var updated = await store.UpdatePlanStatusAsync(workspacePath, plan.Id, "running", cancellationToken)
            .ConfigureAwait(false);
        await store.AppendEventAsync(
            workspacePath,
            plan.Id,
            new AgentTaskPlanLogEventInput(
                "manager_started",
                ToProfileId: plan.ManagerProfileId,
                Message: "Manager started",
                SessionId: managerSession.Id),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                workspacePath,
                "agenthub",
                plan.ManagerProfileId,
                $"Task plan manager started: {plan.Title}"),
            cancellationToken).ConfigureAwait(false);
        return updated;
    }

    public async Task RecordManagerDispatchResultAsync(
        string workspacePath,
        string fromProfileId,
        AgentHubCommandDispatchResult result,
        string? sourceEventId = null,
        CancellationToken cancellationToken = default)
    {
        foreach (var command in result.SentMessages)
        {
            if (string.IsNullOrWhiteSpace(command.PlanId) ||
                string.IsNullOrWhiteSpace(command.CommandAction) ||
                string.IsNullOrWhiteSpace(command.TaskId))
            {
                continue;
            }

            var plan = await TryGetPlanAsync(workspacePath, command.PlanId, cancellationToken).ConfigureAwait(false);
            if (plan is null ||
                !await EnsureManagerAsync(workspacePath, plan, fromProfileId, sourceEventId, cancellationToken)
                    .ConfigureAwait(false))
            {
                continue;
            }

            await RecordSentRoutingCommandAsync(
                workspacePath,
                plan,
                fromProfileId,
                command,
                sourceEventId,
                cancellationToken).ConfigureAwait(false);
        }

        foreach (var command in result.PlanStatusCommands)
        {
            var plan = await TryGetPlanAsync(workspacePath, command.PlanId, cancellationToken).ConfigureAwait(false);
            if (plan is null ||
                !await EnsureManagerAsync(workspacePath, plan, fromProfileId, sourceEventId, cancellationToken)
                    .ConfigureAwait(false))
            {
                continue;
            }

            await RecordPlanStatusCommandAsync(
                workspacePath,
                plan,
                fromProfileId,
                command,
                sourceEventId,
                cancellationToken).ConfigureAwait(false);
        }

        foreach (var error in result.DispatchErrors)
        {
            var command = error.Command;
            if (command is null || string.IsNullOrWhiteSpace(command.PlanId))
            {
                continue;
            }

            var plan = await TryGetPlanAsync(workspacePath, command.PlanId, cancellationToken).ConfigureAwait(false);
            if (plan is null ||
                !await EnsureManagerAsync(workspacePath, plan, fromProfileId, sourceEventId, cancellationToken)
                    .ConfigureAwait(false))
            {
                continue;
            }

            await store.AppendEventAsync(
                workspacePath,
                plan.Id,
                new AgentTaskPlanLogEventInput(
                    "delivery_failed",
                    TaskId: command.TaskId,
                    FromProfileId: fromProfileId,
                    ToProfileId: command.To,
                    Message: error.Message,
                    SourceEventId: sourceEventId),
                cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task RecordDeliveryFailureAsync(
        string workspacePath,
        AgentTaskPlan plan,
        string targetProfileId,
        string message,
        CancellationToken cancellationToken)
    {
        await store.AppendEventAsync(
            workspacePath,
            plan.Id,
            new AgentTaskPlanLogEventInput(
                "delivery_failed",
                ToProfileId: targetProfileId,
                Message: message),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendCommandErrorAsync(workspacePath, message, cancellationToken)
            .ConfigureAwait(false);
    }

    private async Task RecordSentRoutingCommandAsync(
        string workspacePath,
        AgentTaskPlan plan,
        string fromProfileId,
        AgentHubSendMessageCommand command,
        string? sourceEventId,
        CancellationToken cancellationToken)
    {
        var eventType = TaskPlanEventType(command.CommandAction!);
        await store.AppendTaskAsync(
            workspacePath,
            plan.Id,
            new AgentTaskPlanTask(
                command.TaskId!,
                command.TaskId!,
                TaskStatusFor(command.CommandAction!),
                command.To,
                await AttemptForCommandAsync(workspacePath, plan.Id, command, cancellationToken).ConfigureAwait(false),
                command.Message,
                null,
                null,
                DateTimeOffset.UtcNow),
            cancellationToken).ConfigureAwait(false);
        await store.AppendEventAsync(
            workspacePath,
            plan.Id,
            new AgentTaskPlanLogEventInput(
                eventType,
                TaskId: command.TaskId,
                FromProfileId: fromProfileId,
                ToProfileId: command.To,
                Message: command.Message,
                SessionId: command.SessionId,
                SourceEventId: sourceEventId),
            cancellationToken).ConfigureAwait(false);
    }

    private async Task RecordPlanStatusCommandAsync(
        string workspacePath,
        AgentTaskPlan plan,
        string fromProfileId,
        AgentHubPlanStatusCommand command,
        string? sourceEventId,
        CancellationToken cancellationToken)
    {
        if (command.Action == "approve_task" && command.TaskId is not null)
        {
            await store.AppendTaskAsync(
                workspacePath,
                plan.Id,
                new AgentTaskPlanTask(
                    command.TaskId,
                    command.TaskId,
                    "done",
                    null,
                    await CurrentAttemptAsync(workspacePath, plan.Id, command.TaskId, cancellationToken)
                        .ConfigureAwait(false),
                    command.Message,
                    null,
                    null,
                    DateTimeOffset.UtcNow),
                cancellationToken).ConfigureAwait(false);
        }

        if (command.Action == "pause_plan")
        {
            await store.UpdatePlanStatusAsync(workspacePath, plan.Id, "paused", cancellationToken)
                .ConfigureAwait(false);
        }

        await store.AppendEventAsync(
            workspacePath,
            plan.Id,
            new AgentTaskPlanLogEventInput(
                TaskPlanEventType(command.Action),
                TaskId: command.TaskId,
                FromProfileId: fromProfileId,
                Message: command.Message,
                SourceEventId: sourceEventId),
            cancellationToken).ConfigureAwait(false);
    }

    private async Task<bool> EnsureManagerAsync(
        string workspacePath,
        AgentTaskPlan plan,
        string fromProfileId,
        string? sourceEventId,
        CancellationToken cancellationToken)
    {
        if (string.Equals(fromProfileId, plan.ManagerProfileId, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var message = $"Profile {fromProfileId} is not the manager for task plan {plan.Id}";
        await store.AppendEventAsync(
            workspacePath,
            plan.Id,
            new AgentTaskPlanLogEventInput(
                "parse_error",
                FromProfileId: fromProfileId,
                Message: message,
                SourceEventId: sourceEventId),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendCommandErrorAsync(workspacePath, message, cancellationToken)
            .ConfigureAwait(false);
        return false;
    }

    private async Task<AgentTaskPlan?> TryGetPlanAsync(
        string workspacePath,
        string planId,
        CancellationToken cancellationToken)
    {
        try
        {
            return await store.GetPlanAsync(workspacePath, planId, cancellationToken).ConfigureAwait(false);
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    private async Task<int> AttemptForCommandAsync(
        string workspacePath,
        string planId,
        AgentHubSendMessageCommand command,
        CancellationToken cancellationToken)
    {
        if (command.CommandAction == "request_review")
        {
            return await CurrentAttemptAsync(workspacePath, planId, command.TaskId!, cancellationToken)
                .ConfigureAwait(false);
        }

        return await NextRunningAttemptAsync(workspacePath, planId, command.TaskId!, cancellationToken)
            .ConfigureAwait(false);
    }

    private async Task<int> NextRunningAttemptAsync(
        string workspacePath,
        string planId,
        string taskId,
        CancellationToken cancellationToken)
    {
        var history = await store.ListTaskHistoryAsync(workspacePath, planId, cancellationToken)
            .ConfigureAwait(false);
        return history.Count(task => task.Id == taskId && task.Status == "running") + 1;
    }

    private async Task<int> CurrentAttemptAsync(
        string workspacePath,
        string planId,
        string taskId,
        CancellationToken cancellationToken)
    {
        var history = await store.ListTaskHistoryAsync(workspacePath, planId, cancellationToken)
            .ConfigureAwait(false);
        return history
            .Where(task => task.Id == taskId)
            .Select(task => task.Attempt)
            .LastOrDefault(1);
    }

    private static string TaskStatusFor(string action)
    {
        return action == "request_review" ? "review" : "running";
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

    private static string BuildManagerPrompt(AgentTaskPlan plan)
    {
        return string.Join(
            "\r\n",
            [
                "AgentHub task-plan manager.",
                $"Plan ID: {plan.Id}",
                $"Task source task-plan.md: {plan.SourcePlanPath}",
                $"Execution snapshot: {Path.Combine(plan.PlanPath, "task-plan.md")}",
                $"Available agents: {string.Join(", ", plan.ParticipantProfileIds)}",
                "",
                "Use the execution snapshot as the plan for this run. Manage one bounded step at a time. Do not paste long chat history into agent prompts.",
                "Delegate with this exact command shape:",
                "<agenthub>{\"action\":\"assign_task\",\"plan_id\":\"" + plan.Id + "\",\"task_id\":\"T001\",\"to\":\"codex\",\"message\":\"Implement the bounded task\"}</agenthub>",
                "Request review with:",
                "<agenthub>{\"action\":\"request_review\",\"plan_id\":\"" + plan.Id + "\",\"task_id\":\"T001\",\"to\":\"gemini\",\"message\":\"Review the artifact and risks\"}</agenthub>",
                "Approve with:",
                "<agenthub>{\"action\":\"approve_task\",\"plan_id\":\"" + plan.Id + "\",\"task_id\":\"T001\",\"summary\":\"Accepted\"}</agenthub>",
                "Reject with:",
                "<agenthub>{\"action\":\"reject_task\",\"plan_id\":\"" + plan.Id + "\",\"task_id\":\"T001\",\"to\":\"codex\",\"message\":\"Required fixes\"}</agenthub>",
                "Pause with:",
                "<agenthub>{\"action\":\"pause_plan\",\"plan_id\":\"" + plan.Id + "\",\"reason\":\"Need user decision\"}</agenthub>",
                "Wait for hook observations before assigning the next step."
            ]);
    }
}
