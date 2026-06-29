namespace AgentHub.Native.Core.Collaboration;

public sealed record StartAgentManagerConversationRequest(
    string WorkspacePath,
    string Topic,
    IReadOnlyList<string> ParticipantProfileIds,
    string? SupervisorProfileId = null,
    int? MaxSteps = null,
    string? ConversationId = null);
