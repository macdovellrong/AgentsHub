namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentSessionDescriptor(
    string Id,
    string ProfileId,
    string WorkspacePath,
    DateTimeOffset StartedAt);
