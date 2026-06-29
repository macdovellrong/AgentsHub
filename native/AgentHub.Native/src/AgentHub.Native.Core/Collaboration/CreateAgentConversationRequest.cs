namespace AgentHub.Native.Core.Collaboration;

public sealed record CreateAgentConversationRequest(
    string? Id,
    string Mode,
    string? SupervisorProfileId,
    IReadOnlyList<string> ParticipantProfileIds,
    string Topic,
    string? Status = null,
    int CurrentStep = 0,
    int? MaxSteps = null,
    DateTimeOffset? CreatedAt = null,
    DateTimeOffset? UpdatedAt = null);
