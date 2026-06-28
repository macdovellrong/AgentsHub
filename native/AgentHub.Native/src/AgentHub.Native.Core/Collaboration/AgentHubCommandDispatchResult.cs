namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentHubCommandDispatchResult(
    int SentCount,
    IReadOnlyList<AgentHubCommandParseError> ParseErrors,
    IReadOnlyList<AgentHubCommandDispatchError> DispatchErrors);
