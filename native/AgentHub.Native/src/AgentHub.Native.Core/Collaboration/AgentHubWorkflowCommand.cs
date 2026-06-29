namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentHubWorkflowCommand(
    string Action,
    string? Message);
