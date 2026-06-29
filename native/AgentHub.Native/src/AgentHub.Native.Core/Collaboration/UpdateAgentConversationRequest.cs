namespace AgentHub.Native.Core.Collaboration;

public sealed record UpdateAgentConversationRequest(
    string? Status = null,
    string? SupervisorProfileId = null,
    IReadOnlyList<string>? ParticipantProfileIds = null,
    string? Topic = null,
    int? CurrentStep = null,
    int? MaxSteps = null,
    DateTimeOffset? UpdatedAt = null);
