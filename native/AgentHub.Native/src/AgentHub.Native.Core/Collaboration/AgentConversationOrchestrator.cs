using AgentHub.Native.Core.Input;

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
}
