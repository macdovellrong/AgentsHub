namespace AgentHub.Native.Core.Collaboration;

public sealed record CollaborationUserMessage(
    string WorkspacePath,
    string ProfileId,
    string TargetProfileId,
    string Message,
    string? ConversationId = null,
    string? TaskId = null,
    string? TeamId = null,
    string? PlanId = null,
    string? SessionId = null);
