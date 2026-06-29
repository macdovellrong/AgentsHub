namespace AgentHub.Native.Core.Collaboration;

public sealed record CollaborationEvent(
    string Id,
    DateTimeOffset Timestamp,
    CollaborationEventKind Kind,
    string WorkspacePath,
    string Message,
    string? ProfileId,
    string? TargetProfileId,
    string? SessionId,
    string? RunId,
    string? Source,
    string? PlanId = null,
    string? TaskId = null,
    string? ConversationId = null,
    string? TeamId = null);
