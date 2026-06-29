namespace AgentHub.Native.Core.TaskPlans;

public sealed record AgentTaskPlanLogEvent(
    string Id,
    string Type,
    DateTimeOffset Timestamp,
    string? TaskId,
    string? FromProfileId,
    string? ToProfileId,
    string? Message,
    string? ArtifactPath,
    string? SessionId,
    string? RunId,
    string? SourceEventId);
