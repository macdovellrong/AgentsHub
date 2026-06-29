namespace AgentHub.Native.Core.TaskPlans;

public sealed record CreateAgentTaskPlanRequest(
    string Title,
    string SourceTaskDirectoryName,
    string ManagerProfileId,
    IReadOnlyList<string> ParticipantProfileIds);
