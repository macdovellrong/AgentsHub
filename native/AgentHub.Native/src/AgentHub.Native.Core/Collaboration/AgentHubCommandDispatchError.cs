namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentHubCommandDispatchError(
    string TargetProfileId,
    string Message,
    AgentHubSendMessageCommand? Command = null,
    AgentHubPairNegotiationCommand? PairNegotiationCommand = null);
