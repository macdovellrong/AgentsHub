namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentTaskUpdateRequest(
    string? Title = null,
    string? Description = null,
    string? Status = null,
    string? ProfileId = null,
    string? RunId = null);
