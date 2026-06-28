namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentHubCommandDispatchError(
    string TargetProfileId,
    string Message);
