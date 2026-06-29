namespace AgentHub.Native.Core.Collaboration;

public sealed record StartPairNegotiationConversationRequest(
    string WorkspacePath,
    string Topic,
    IReadOnlyList<string> ParticipantProfileIds,
    int? MaxRounds = null,
    string? ConversationId = null);
