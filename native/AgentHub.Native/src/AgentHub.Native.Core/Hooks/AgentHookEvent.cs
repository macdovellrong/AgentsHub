namespace AgentHub.Native.Core.Hooks;

public sealed record AgentHookEvent(
    string Workspace,
    string Message,
    string? ProfileId,
    string? SessionId,
    string? RunId,
    string? Source,
    string? PlanId = null,
    string? TaskId = null,
    string? ConversationId = null,
    string? TeamId = null);
