namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentHubCommandDispatchResult(
    int SentCount,
    IReadOnlyList<AgentHubSendMessageCommand> SentMessages,
    IReadOnlyList<AgentHubPlanStatusCommand> PlanStatusCommands,
    IReadOnlyList<AgentHubTeamStatusCommand> TeamStatusCommands,
    IReadOnlyList<AgentHubWorkflowCommand> WorkflowCommands,
    IReadOnlyList<AgentHubCommandParseError> ParseErrors,
    IReadOnlyList<AgentHubCommandDispatchError> DispatchErrors);
