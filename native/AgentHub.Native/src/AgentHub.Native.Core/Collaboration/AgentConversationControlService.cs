namespace AgentHub.Native.Core.Collaboration;

public sealed class AgentConversationControlService(
    AgentConversationStore conversationStore,
    CollaborationEventStore timelineStore)
{
    public Task<AgentConversation> PauseAsync(
        string workspacePath,
        string conversationId,
        string reason,
        CancellationToken cancellationToken = default)
    {
        return ChangeStatusAsync(
            workspacePath,
            conversationId,
            "paused",
            ["running", "paused"],
            "pause_conversation",
            DefaultReason(reason, "Paused by user"),
            cancellationToken);
    }

    public Task<AgentConversation> ResumeAsync(
        string workspacePath,
        string conversationId,
        string reason,
        CancellationToken cancellationToken = default)
    {
        return ChangeStatusAsync(
            workspacePath,
            conversationId,
            "running",
            ["paused"],
            "resume_conversation",
            DefaultReason(reason, "Resumed by user"),
            cancellationToken);
    }

    public Task<AgentConversation> StopAsync(
        string workspacePath,
        string conversationId,
        string reason,
        CancellationToken cancellationToken = default)
    {
        return ChangeStatusAsync(
            workspacePath,
            conversationId,
            "stopped",
            ["running", "paused", "failed", "stopped"],
            "stop_conversation",
            DefaultReason(reason, "Stopped by user"),
            cancellationToken);
    }

    private async Task<AgentConversation> ChangeStatusAsync(
        string workspacePath,
        string conversationId,
        string nextStatus,
        IReadOnlyCollection<string> allowedCurrentStatuses,
        string timelineAction,
        string reason,
        CancellationToken cancellationToken)
    {
        var existing = (await conversationStore.ListAsync(workspacePath, cancellationToken).ConfigureAwait(false))
            .FirstOrDefault(item => string.Equals(item.Id, conversationId, StringComparison.Ordinal));
        if (existing is null)
        {
            throw new InvalidOperationException($"Unknown conversation: {conversationId}");
        }

        if (!allowedCurrentStatuses.Contains(existing.Status))
        {
            throw new InvalidOperationException(
                $"Cannot {Verb(timelineAction)} conversation '{conversationId}' from status '{existing.Status}'.");
        }

        var updated = await conversationStore.UpdateAsync(
            workspacePath,
            conversationId,
            new UpdateAgentConversationRequest(Status: nextStatus),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                workspacePath,
                "agenthub",
                "conversation",
                $"[{timelineAction}] {reason}",
                ConversationId: conversationId),
            cancellationToken).ConfigureAwait(false);
        return updated;
    }

    private static string DefaultReason(string reason, string fallback)
    {
        return string.IsNullOrWhiteSpace(reason) ? fallback : reason.Trim();
    }

    private static string Verb(string timelineAction)
    {
        return timelineAction switch
        {
            "pause_conversation" => "pause",
            "resume_conversation" => "resume",
            "stop_conversation" => "stop",
            _ => "update"
        };
    }
}
