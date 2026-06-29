namespace AgentHub.Native.Core.TaskPlans;

public sealed record AgentTaskPlan(
    string Id,
    string Title,
    string Status,
    string ManagerProfileId,
    IReadOnlyList<string> ParticipantProfileIds,
    string Date,
    string DirectoryName,
    string PlanPath,
    string SourceTaskDir,
    string SourcePlanPath,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
