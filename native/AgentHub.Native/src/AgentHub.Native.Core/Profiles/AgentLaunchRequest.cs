namespace AgentHub.Native.Core.Profiles;

public sealed record AgentLaunchRequest(
    AgentKind AgentKind,
    ShellKind ShellKind,
    string WorkingDirectory,
    string Command,
    IReadOnlyList<string> Arguments,
    IReadOnlyDictionary<string, string>? EnvironmentVariables = null);
