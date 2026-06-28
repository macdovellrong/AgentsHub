namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentHubCommandParseResult(
    IReadOnlyList<AgentHubSendMessageCommand> SendMessages,
    IReadOnlyList<AgentHubPlanStatusCommand> PlanStatusCommands,
    IReadOnlyList<AgentHubCommandParseError> Errors);
