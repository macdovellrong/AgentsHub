namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentHubSendMessageCommand(
    string To,
    string Message,
    string? TeamId,
    string? TaskId,
    string? PlanId,
    string? ConversationId,
    string? SessionId = null);
