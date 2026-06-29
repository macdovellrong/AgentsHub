namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentTeam(
    string Id,
    string Name,
    IReadOnlyList<string> MemberProfileIds,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
