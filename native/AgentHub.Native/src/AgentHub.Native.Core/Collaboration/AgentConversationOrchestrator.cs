using AgentHub.Native.Core.Input;
using AgentHub.Native.Core.Hooks;

namespace AgentHub.Native.Core.Collaboration;

public sealed class AgentConversationOrchestrator(
    AgentConversationStore conversationStore,
    CollaborationEventStore timelineStore,
    AgentInputRouter inputRouter,
    AgentSessionRegistry sessionRegistry)
{
    private const int DefaultMaxSteps = 12;

    public async Task<AgentConversation> StartManagerAsync(
        StartAgentManagerConversationRequest request,
        CancellationToken cancellationToken = default)
    {
        var supervisorProfileId = string.IsNullOrWhiteSpace(request.SupervisorProfileId)
            ? "claude"
            : request.SupervisorProfileId;
        var conversation = await conversationStore.CreateAsync(
            request.WorkspacePath,
            new CreateAgentConversationRequest(
                request.ConversationId,
                "manager",
                supervisorProfileId,
                request.ParticipantProfileIds,
                request.Topic,
                MaxSteps: request.MaxSteps ?? DefaultMaxSteps),
            cancellationToken).ConfigureAwait(false);

        var supervisorSession = sessionRegistry.FindLatest(request.WorkspacePath, supervisorProfileId);
        if (supervisorSession is null)
        {
            var error = $"No active session for profile '{supervisorProfileId}'";
            await timelineStore.AppendCommandErrorAsync(
                request.WorkspacePath,
                error,
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return await conversationStore.UpdateAsync(
                request.WorkspacePath,
                conversation.Id,
                new UpdateAgentConversationRequest(Status: "failed"),
                cancellationToken).ConfigureAwait(false);
        }

        var prompt = BuildInitialManagerPrompt(conversation);
        var sendResult = await inputRouter.TrySendLineDetailedAsync(supervisorSession.Id, prompt, cancellationToken)
            .ConfigureAwait(false);
        if (!sendResult.Sent)
        {
            if (sendResult.ShouldRemoveSession)
            {
                sessionRegistry.Remove(supervisorSession.Id);
            }

            var error = $"Unable to send manager conversation prompt to session '{supervisorSession.Id}': {sendResult.Status}";
            await timelineStore.AppendCommandErrorAsync(
                request.WorkspacePath,
                error,
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return await conversationStore.UpdateAsync(
                request.WorkspacePath,
                conversation.Id,
                new UpdateAgentConversationRequest(Status: "failed"),
                cancellationToken).ConfigureAwait(false);
        }

        var updated = await conversationStore.UpdateAsync(
            request.WorkspacePath,
            conversation.Id,
            new UpdateAgentConversationRequest(CurrentStep: conversation.CurrentStep + 1),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                request.WorkspacePath,
                "agenthub",
                supervisorProfileId,
                $"Manager conversation started: {conversation.Topic}",
                ConversationId: conversation.Id,
                SessionId: supervisorSession.Id),
            cancellationToken).ConfigureAwait(false);
        return updated;
    }

    public async Task<bool> CanHandleAgentOutputAsync(
        AgentHookEvent hookEvent,
        CancellationToken cancellationToken = default)
    {
        return await FindManagedSupervisorConversationAsync(hookEvent, cancellationToken)
            .ConfigureAwait(false) is not null;
    }

    public async Task<bool> HandleAgentOutputAsync(
        AgentHookEvent hookEvent,
        CancellationToken cancellationToken = default)
    {
        var conversation = await FindManagedSupervisorConversationAsync(hookEvent, cancellationToken)
            .ConfigureAwait(false);
        if (conversation is null)
        {
            return false;
        }

        var parsed = AgentHubCommandParser.Parse(hookEvent.Message);
        foreach (var error in parsed.Errors)
        {
            await timelineStore.AppendCommandErrorAsync(
                hookEvent.Workspace,
                $"[parse_error {error.Code} #{error.Index}] {error.Message}",
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
        }

        foreach (var command in parsed.SendMessages)
        {
            conversation = await RouteManagerSendCommandAsync(
                hookEvent.Workspace,
                conversation,
                command,
                cancellationToken).ConfigureAwait(false);
        }

        foreach (var command in parsed.WorkflowCommands)
        {
            conversation = await ApplyManagerWorkflowCommandAsync(
                hookEvent.Workspace,
                conversation,
                command,
                cancellationToken).ConfigureAwait(false);
        }

        return true;
    }

    private async Task<AgentConversation?> FindManagedSupervisorConversationAsync(
        AgentHookEvent hookEvent,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(hookEvent.ConversationId) ||
            string.IsNullOrWhiteSpace(hookEvent.ProfileId))
        {
            return null;
        }

        return (await conversationStore.ListAsync(hookEvent.Workspace, cancellationToken)
                .ConfigureAwait(false))
            .FirstOrDefault(item =>
                string.Equals(item.Id, hookEvent.ConversationId, StringComparison.Ordinal) &&
                item.Mode == "manager" &&
                item.Status == "running" &&
                string.Equals(item.SupervisorProfileId, hookEvent.ProfileId, StringComparison.OrdinalIgnoreCase));
    }

    private async Task<AgentConversation> RouteManagerSendCommandAsync(
        string workspacePath,
        AgentConversation conversation,
        AgentHubSendMessageCommand command,
        CancellationToken cancellationToken)
    {
        var targetSession = sessionRegistry.FindLatest(workspacePath, command.To);
        if (targetSession is null)
        {
            await timelineStore.AppendCommandErrorAsync(
                workspacePath,
                $"No active session for profile '{command.To}' in workspace '{workspacePath}'.",
                conversation.Id,
                command.TaskId,
                command.TeamId,
                command.PlanId,
                cancellationToken).ConfigureAwait(false);
            return conversation;
        }

        var sendResult = await inputRouter.TrySendLineDetailedAsync(
            targetSession.Id,
            BuildDelegatedTaskPrompt(conversation, command),
            cancellationToken).ConfigureAwait(false);
        if (!sendResult.Sent)
        {
            if (sendResult.ShouldRemoveSession)
            {
                sessionRegistry.Remove(targetSession.Id);
            }

            await timelineStore.AppendCommandErrorAsync(
                workspacePath,
                $"Unable to send manager conversation task to session '{targetSession.Id}': {sendResult.Status}",
                conversation.Id,
                command.TaskId,
                command.TeamId,
                command.PlanId,
                cancellationToken).ConfigureAwait(false);
            return conversation;
        }

        var nextStep = conversation.CurrentStep + 1;
        var nextStatus = conversation.MaxSteps is not null && nextStep >= conversation.MaxSteps
            ? "paused"
            : conversation.Status;
        var updated = await conversationStore.UpdateAsync(
            workspacePath,
            conversation.Id,
            new UpdateAgentConversationRequest(Status: nextStatus, CurrentStep: nextStep),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                workspacePath,
                "agenthub",
                command.To,
                command.Message,
                conversation.Id,
                command.TaskId,
                command.TeamId,
                command.PlanId,
                targetSession.Id),
            cancellationToken).ConfigureAwait(false);
        return updated;
    }

    private async Task<AgentConversation> ApplyManagerWorkflowCommandAsync(
        string workspacePath,
        AgentConversation conversation,
        AgentHubWorkflowCommand command,
        CancellationToken cancellationToken)
    {
        var nextStatus = command.Action switch
        {
            "ask_user" => "paused",
            "done" => "completed",
            _ => conversation.Status
        };
        if (nextStatus == conversation.Status && command.Action is not ("ask_user" or "done"))
        {
            return conversation;
        }

        var updated = await conversationStore.UpdateAsync(
            workspacePath,
            conversation.Id,
            new UpdateAgentConversationRequest(Status: nextStatus),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                workspacePath,
                "agenthub",
                "workflow",
                FormatWorkflowCommand(command),
                conversation.Id),
            cancellationToken).ConfigureAwait(false);
        return updated;
    }

    private static string BuildInitialManagerPrompt(AgentConversation conversation)
    {
        return string.Join(
            "\r\n",
            [
                "AgentHub manager conversation.",
                $"Conversation: {conversation.Id}",
                $"Topic: {conversation.Topic}",
                $"Participants: {string.Join(", ", conversation.ParticipantProfileIds)}",
                "Delegate work with exactly this command format when another agent should act:",
                "<agenthub>{\"action\":\"send\",\"target\":\"codex\",\"task_id\":\"T-001\",\"message\":\"Task details\"}</agenthub>",
                "Wait for observations before sending the next task."
            ]);
    }

    private static string BuildDelegatedTaskPrompt(
        AgentConversation conversation,
        AgentHubSendMessageCommand command)
    {
        var lines = new List<string>
        {
            "AgentHub delegated task.",
            $"Conversation: {conversation.Id}"
        };
        if (!string.IsNullOrWhiteSpace(command.PlanId))
        {
            lines.Add($"Plan: {command.PlanId}");
        }

        if (!string.IsNullOrWhiteSpace(command.TaskId))
        {
            lines.Add($"Task: {command.TaskId}");
        }

        lines.Add("");
        lines.Add(command.Message);
        lines.Add("");
        lines.Add("When finished, rely on the configured AgentHub hook to return your final result. Keep the result focused on this task.");
        return string.Join("\r\n", lines);
    }

    private static string FormatWorkflowCommand(AgentHubWorkflowCommand command)
    {
        var message = string.IsNullOrWhiteSpace(command.Message) ? "completed" : command.Message;
        return $"[{command.Action}] {message}";
    }
}
