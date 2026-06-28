namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentHubSendMessageCommand(
    string To,
    string Message,
    string? TeamId,
    string? TaskId,
    string? ConversationId);
