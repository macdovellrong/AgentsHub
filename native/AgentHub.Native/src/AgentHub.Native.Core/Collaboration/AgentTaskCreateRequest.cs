namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentTaskCreateRequest(
    string Title,
    string Description,
    string? Status = null,
    string? ProfileId = null,
    string? RunId = null);
