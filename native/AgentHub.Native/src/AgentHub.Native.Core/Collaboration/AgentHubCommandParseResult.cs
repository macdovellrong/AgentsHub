namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentHubCommandParseResult(
    IReadOnlyList<AgentHubSendMessageCommand> SendMessages,
    IReadOnlyList<AgentHubPlanStatusCommand> PlanStatusCommands,
    IReadOnlyList<AgentHubTeamStatusCommand> TeamStatusCommands,
    IReadOnlyList<AgentHubWorkflowCommand> WorkflowCommands,
    IReadOnlyList<AgentHubPairNegotiationCommand> PairNegotiationCommands,
    IReadOnlyList<AgentHubCommandParseError> Errors);
