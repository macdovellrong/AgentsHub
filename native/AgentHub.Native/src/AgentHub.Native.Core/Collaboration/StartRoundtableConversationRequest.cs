namespace AgentHub.Native.Core.Collaboration;

public sealed record StartRoundtableConversationRequest(
    string WorkspacePath,
    string Topic,
    IReadOnlyList<string> ParticipantProfileIds,
    int? MaxRounds = null,
    string? ConversationId = null);
