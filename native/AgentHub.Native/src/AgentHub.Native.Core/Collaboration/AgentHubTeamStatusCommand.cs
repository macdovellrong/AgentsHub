namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentHubTeamStatusCommand(
    string Action,
    string TeamId,
    string TaskId,
    string? Summary);
