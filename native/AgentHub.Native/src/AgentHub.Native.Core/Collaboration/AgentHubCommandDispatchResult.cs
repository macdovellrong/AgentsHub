namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentHubCommandDispatchResult(
    int SentCount,
    IReadOnlyList<AgentHubSendMessageCommand> SentMessages,
    IReadOnlyList<AgentHubPlanStatusCommand> PlanStatusCommands,
    IReadOnlyList<AgentHubCommandParseError> ParseErrors,
    IReadOnlyList<AgentHubCommandDispatchError> DispatchErrors);
