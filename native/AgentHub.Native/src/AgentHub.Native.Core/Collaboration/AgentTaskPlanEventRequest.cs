namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentTaskPlanEventRequest(
    string PlanId,
    string Type,
    string? TaskId,
    string? FromProfileId,
    string? ToProfileId,
    string? Message,
    string? SessionId,
    string? RunId,
    string? SourceEventId);
