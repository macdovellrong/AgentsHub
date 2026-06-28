namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentHubPlanStatusCommand(
    string Action,
    string PlanId,
    string? TaskId,
    string Message);
