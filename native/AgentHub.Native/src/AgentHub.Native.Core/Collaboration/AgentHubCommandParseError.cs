namespace AgentHub.Native.Core.Collaboration;

public sealed record AgentHubCommandParseError(
    int Index,
    string Code,
    string Message,
    string Block);
