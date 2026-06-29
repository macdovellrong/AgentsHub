namespace AgentHub.Native.Core.TaskPlans;

public sealed record AgentTaskPlanTask(
    string Id,
    string Title,
    string Status,
    string? AssigneeProfileId,
    int Attempt,
    string? Description,
    string? RunId,
    string? ArtifactPath,
    DateTimeOffset UpdatedAt);
