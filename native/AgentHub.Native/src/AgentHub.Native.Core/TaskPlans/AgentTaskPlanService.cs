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

    public async Task RecordHookCompletionAsync(
        string workspacePath,
        AgentTaskPlanHookCompletionInput input,
        CancellationToken cancellationToken = default)
    {
        var target = await ResolveCompletionTargetAsync(workspacePath, input, cancellationToken).ConfigureAwait(false);
        if (target is null)
        {
            await RecordUnmatchedHookAsync(workspacePath, input, cancellationToken).ConfigureAwait(false);
            return;
        }

        var (plan, taskId) = target.Value;
        if (!string.IsNullOrWhiteSpace(input.SourceEventId) &&
            await HasCompletedSourceEventAsync(workspacePath, plan.Id, input.SourceEventId, cancellationToken)
                .ConfigureAwait(false))
        {
            return;
        }

        var artifactPath = await WriteUniqueArtifactAsync(plan, taskId, input.ProfileId, input.RunId, input.Message, cancellationToken)
            .ConfigureAwait(false);
        await store.AppendTaskAsync(
            workspacePath,
            plan.Id,
            new AgentTaskPlanTask(
                taskId,
                taskId,
                "review",
                input.ProfileId,
                await CurrentAttemptAsync(workspacePath, plan.Id, taskId, cancellationToken).ConfigureAwait(false),
                input.Message,
                input.RunId,
                artifactPath,
                DateTimeOffset.UtcNow),
            cancellationToken).ConfigureAwait(false);
        await store.AppendEventAsync(
            workspacePath,
            plan.Id,
            new AgentTaskPlanLogEventInput(
                "hook_completed",
                TaskId: taskId,
                FromProfileId: input.ProfileId,
                ToProfileId: plan.ManagerProfileId,
                Message: input.Message,
                ArtifactPath: artifactPath,
                SessionId: input.SessionId,
                RunId: input.RunId,
                SourceEventId: input.SourceEventId),
            cancellationToken).ConfigureAwait(false);

        await ObserveManagerAsync(workspacePath, plan, taskId, input, artifactPath, cancellationToken)
            .ConfigureAwait(false);
    }

    private async Task RecordUnmatchedHookAsync(
        string workspacePath,
        AgentTaskPlanHookCompletionInput input,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(input.PlanId))
        {
            return;
        }

        var plan = await TryGetPlanAsync(workspacePath, input.PlanId, cancellationToken).ConfigureAwait(false);
        if (plan is null)
        {
            return;
        }

        await store.AppendEventAsync(
            workspacePath,
            plan.Id,
            new AgentTaskPlanLogEventInput(
                "unmatched_hook",
                TaskId: input.TaskId,
                FromProfileId: input.ProfileId,
                Message: input.Message,
                SessionId: input.SessionId,
                RunId: input.RunId,
                SourceEventId: input.SourceEventId),
            cancellationToken).ConfigureAwait(false);
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

    private async Task ObserveManagerAsync(
        string workspacePath,
        AgentTaskPlan plan,
        string taskId,
        AgentTaskPlanHookCompletionInput input,
        string artifactPath,
        CancellationToken cancellationToken)
    {
        var managerSession = sessionRegistry.FindLatest(workspacePath, plan.ManagerProfileId);
        if (managerSession is null)
        {
            await RecordHookObservationFailureAsync(
                workspacePath,
                plan,
                taskId,
                input.ProfileId,
                artifactPath,
                $"No active session for profile '{plan.ManagerProfileId}'",
                cancellationToken).ConfigureAwait(false);
            return;
        }

        var prompt = BuildHookObservationPrompt(plan, taskId, input, artifactPath);
        var sendResult = await inputRouter.TrySendLineDetailedAsync(managerSession.Id, prompt, cancellationToken)
            .ConfigureAwait(false);
        if (!sendResult.Sent)
        {
            if (sendResult.ShouldRemoveSession)
            {
                sessionRegistry.Remove(managerSession.Id);
            }

            await RecordHookObservationFailureAsync(
                workspacePath,
                plan,
                taskId,
                input.ProfileId,
                artifactPath,
                $"Unable to send task-plan hook observation to session '{managerSession.Id}': {sendResult.Status}",
                cancellationToken).ConfigureAwait(false);
            return;
        }

        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                workspacePath,
                "agenthub",
                plan.ManagerProfileId,
                $"Task plan hook observed: {taskId}"),
            cancellationToken).ConfigureAwait(false);
    }

    private async Task RecordHookObservationFailureAsync(
        string workspacePath,
        AgentTaskPlan plan,
        string taskId,
        string fromProfileId,
        string artifactPath,
        string message,
        CancellationToken cancellationToken)
    {
        await store.AppendEventAsync(
            workspacePath,
            plan.Id,
            new AgentTaskPlanLogEventInput(
                "delivery_failed",
                TaskId: taskId,
                FromProfileId: fromProfileId,
                ToProfileId: plan.ManagerProfileId,
                Message: message,
                ArtifactPath: artifactPath),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendCommandErrorAsync(workspacePath, message, cancellationToken)
            .ConfigureAwait(false);
    }

    private async Task<(AgentTaskPlan Plan, string TaskId)?> ResolveCompletionTargetAsync(
        string workspacePath,
        AgentTaskPlanHookCompletionInput input,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(input.PlanId) && !string.IsNullOrWhiteSpace(input.TaskId))
        {
            var explicitPlan = await TryGetPlanAsync(workspacePath, input.PlanId, cancellationToken).ConfigureAwait(false);
            return explicitPlan is null ? null : (explicitPlan, input.TaskId);
        }

        var plans = string.IsNullOrWhiteSpace(input.PlanId)
            ? await store.ListPlansAsync(workspacePath, cancellationToken).ConfigureAwait(false)
            : await ListSinglePlanAsync(workspacePath, input.PlanId, cancellationToken).ConfigureAwait(false);
        foreach (var plan in plans)
        {
            var events = await store.ListEventsAsync(workspacePath, plan.Id, cancellationToken).ConfigureAwait(false);
            for (var index = events.Count - 1; index >= 0; index--)
            {
                var item = events[index];
                if (!IsRoutingEventForCompletion(item, input) ||
                    HasLaterCompletion(events, index, item, input))
                {
                    continue;
                }

                return (plan, item.TaskId!);
            }
        }

        return null;
    }

    private async Task<IReadOnlyList<AgentTaskPlan>> ListSinglePlanAsync(
        string workspacePath,
        string planId,
        CancellationToken cancellationToken)
    {
        var plan = await TryGetPlanAsync(workspacePath, planId, cancellationToken).ConfigureAwait(false);
        return plan is null ? [] : [plan];
    }

    private static bool IsRoutingEventForCompletion(
        AgentTaskPlanLogEvent item,
        AgentTaskPlanHookCompletionInput input)
    {
        return item.Type is "assigned" or "rejected" or "review_requested" &&
               !string.IsNullOrWhiteSpace(item.TaskId) &&
               string.Equals(item.ToProfileId, input.ProfileId, StringComparison.OrdinalIgnoreCase) &&
               SessionMatches(item.SessionId, input.SessionId);
    }

    private static bool HasLaterCompletion(
        IReadOnlyList<AgentTaskPlanLogEvent> events,
        int routeEventIndex,
        AgentTaskPlanLogEvent routeEvent,
        AgentTaskPlanHookCompletionInput input)
    {
        for (var index = routeEventIndex + 1; index < events.Count; index++)
        {
            var item = events[index];
            if (item.Type == "hook_completed" &&
                string.Equals(item.TaskId, routeEvent.TaskId, StringComparison.Ordinal) &&
                string.Equals(item.FromProfileId, input.ProfileId, StringComparison.OrdinalIgnoreCase) &&
                SessionMatches(routeEvent.SessionId, item.SessionId))
            {
                return true;
            }
        }

        return false;
    }

    private async Task<bool> HasCompletedSourceEventAsync(
        string workspacePath,
        string planId,
        string sourceEventId,
        CancellationToken cancellationToken)
    {
        var events = await store.ListEventsAsync(workspacePath, planId, cancellationToken).ConfigureAwait(false);
        return events.Any(item =>
            item.Type == "hook_completed" &&
            string.Equals(item.SourceEventId, sourceEventId, StringComparison.Ordinal));
    }

    private static bool SessionMatches(string? routeSessionId, string? completionSessionId)
    {
        return string.IsNullOrWhiteSpace(routeSessionId) ||
               string.IsNullOrWhiteSpace(completionSessionId) ||
               string.Equals(routeSessionId, completionSessionId, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<string> WriteUniqueArtifactAsync(
        AgentTaskPlan plan,
        string taskId,
        string profileId,
        string? runId,
        string content,
        CancellationToken cancellationToken)
    {
        var artifactsPath = Path.Combine(plan.PlanPath, "artifacts");
        Directory.CreateDirectory(artifactsPath);
        var baseName = $"{SafeFileToken(taskId)}-{SafeFileToken(profileId)}";
        if (!string.IsNullOrWhiteSpace(runId))
        {
            baseName += $"-{SafeFileToken(runId)}";
        }

        for (var index = 1; index < 1000; index++)
        {
            var fileName = index == 1 ? $"{baseName}.md" : $"{baseName}-{index}.md";
            var fullPath = Path.Combine(artifactsPath, fileName);
            try
            {
                await using var stream = new FileStream(fullPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
                await using var writer = new StreamWriter(stream);
                await writer.WriteAsync(content.AsMemory(), cancellationToken).ConfigureAwait(false);
                return $"artifacts/{fileName}";
            }
            catch (IOException) when (File.Exists(fullPath))
            {
            }
        }

        throw new IOException($"Unable to create unique artifact for task '{taskId}'");
    }

    private static string SafeFileToken(string value)
    {
        var chars = value
            .Trim()
            .Select(character => char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '-' ? character : '-')
            .ToArray();
        var token = string.Join(
            "-",
            new string(chars)
                .Split('-', StringSplitOptions.RemoveEmptyEntries));
        return string.IsNullOrWhiteSpace(token) || token is "." or ".." ? "value" : token;
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

    private static string BuildHookObservationPrompt(
        AgentTaskPlan plan,
        string taskId,
        AgentTaskPlanHookCompletionInput input,
        string artifactPath)
    {
        return string.Join(
            "\r\n",
            [
                "AgentHub delegated task completed observation.",
                $"Plan ID: {plan.Id}",
                $"Task: {taskId}",
                $"From: {input.ProfileId}",
                $"Artifact: {artifactPath}",
                "",
                input.Message,
                "",
                "Review the artifact. Approve or reject with one exact command:",
                "<agenthub>{\"action\":\"approve_task\",\"plan_id\":\"" + plan.Id + "\",\"task_id\":\"" + taskId + "\",\"summary\":\"Accepted\"}</agenthub>",
                "<agenthub>{\"action\":\"reject_task\",\"plan_id\":\"" + plan.Id + "\",\"task_id\":\"" + taskId + "\",\"to\":\"" + input.ProfileId + "\",\"message\":\"Required fixes\"}</agenthub>"
            ]);
    }
}
