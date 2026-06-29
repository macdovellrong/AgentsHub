namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentHubPairNegotiationCommand(
    string Action,
    double ProposalVersion,
    string? Message,
    string? ArtifactPath,
    string? MessageTo,
    string? Summary,
    string? Stance,
    string? DispatchMessage = null,
    string? SessionId = null);
