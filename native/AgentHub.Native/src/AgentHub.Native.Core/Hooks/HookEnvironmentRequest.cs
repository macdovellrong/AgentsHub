namespace AgentHub.Native.Core.Hooks;

public sealed record HookEnvironmentRequest(
    string HookUrl,
    string HookToken,
    string SessionId,
    string RunId,
    string ProfileId,
    string Workspace,
    string? HookLogPath = null);
