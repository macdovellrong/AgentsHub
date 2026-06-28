namespace AgentHub.Native.Core.Profiles;

public sealed record AgentStartupCommand(
    AgentKind AgentKind,
    string Command,
    IReadOnlyList<string> Arguments);
