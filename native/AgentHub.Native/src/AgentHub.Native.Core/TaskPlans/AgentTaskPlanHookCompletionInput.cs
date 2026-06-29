namespace AgentHub.Native.Core.TaskPlans;

public sealed record AgentTaskPlanHookCompletionInput(
    string ProfileId,
    string Message,
    string? SessionId = null,
    string? RunId = null,
    string? PlanId = null,
    string? TaskId = null,
    string? SourceEventId = null);
