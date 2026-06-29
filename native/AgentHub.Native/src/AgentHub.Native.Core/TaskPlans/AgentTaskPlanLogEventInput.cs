namespace AgentHub.Native.Core.TaskPlans;

public sealed record AgentTaskPlanLogEventInput(
    string Type,
    string? TaskId = null,
    string? FromProfileId = null,
    string? ToProfileId = null,
    string? Message = null,
    string? ArtifactPath = null,
    string? SessionId = null,
    string? RunId = null,
    string? SourceEventId = null);
