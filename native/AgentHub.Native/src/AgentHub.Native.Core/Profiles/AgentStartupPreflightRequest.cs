namespace AgentHub.Native.Core.Profiles;

public sealed record AgentStartupPreflightRequest(
    AgentStartupCommand StartupCommand,
    string? HookScriptsDirectory,
    string? HookPythonCommand);
