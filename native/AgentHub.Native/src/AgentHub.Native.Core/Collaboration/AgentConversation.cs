namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentConversation(
    string Id,
    string Mode,
    string Status,
    string? SupervisorProfileId,
    IReadOnlyList<string> ParticipantProfileIds,
    string Topic,
    int CurrentStep,
    int? MaxSteps,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
