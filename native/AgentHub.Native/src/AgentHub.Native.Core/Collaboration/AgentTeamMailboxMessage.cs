namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentTeamMailboxMessage(
    string Id,
    string TeamId,
    string Action,
    string FromProfileId,
    string? ToProfileId,
    string Message,
    string? TaskId,
    string? ConversationId,
    string Status,
    string? SessionId,
    string? Error,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
