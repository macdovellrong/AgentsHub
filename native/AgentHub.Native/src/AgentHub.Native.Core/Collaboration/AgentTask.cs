namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentTask(
    string Id,
    string Title,
    string Description,
    string Status,
    string? ProfileId,
    string? RunId,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
