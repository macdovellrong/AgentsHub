namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentHubCommandDispatchResult(
    int SentCount,
    IReadOnlyList<AgentHubSendMessageCommand> SentMessages,
    IReadOnlyList<AgentHubPlanStatusCommand> PlanStatusCommands,
    IReadOnlyList<AgentHubTeamStatusCommand> TeamStatusCommands,
    IReadOnlyList<AgentHubWorkflowCommand> WorkflowCommands,
    IReadOnlyList<AgentHubPairNegotiationCommand> PairNegotiationCommands,
    IReadOnlyList<AgentHubCommandParseError> ParseErrors,
    IReadOnlyList<AgentHubCommandDispatchError> DispatchErrors)
{
    public string? SourceEventId { get; init; }
}
