namespace AgentHub.Native.Core.Profiles;

public sealed record AgentLaunchPlan(
    AgentKind AgentKind,
    ShellKind ShellKind,
    string WorkingDirectory,
    string Executable,
    IReadOnlyList<string> Arguments,
    string CommandText);
