namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentTeamRequest(
    string Id,
    string Name,
    IReadOnlyList<string> MemberProfileIds);
