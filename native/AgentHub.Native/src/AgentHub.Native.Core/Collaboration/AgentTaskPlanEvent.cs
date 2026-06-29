namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentTaskPlanEvent(
    string Id,
    string PlanId,
    string Type,
    DateTimeOffset Timestamp,
    string? TaskId,
    string? FromProfileId,
    string? ToProfileId,
    string? Message,
    string? SessionId,
    string? RunId,
    string? SourceEventId);
