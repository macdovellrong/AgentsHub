namespace AgentHub.Native.Core.Hooks;

public static class HookEnvironmentBuilder
{
    public static IReadOnlyDictionary<string, string> Build(HookEnvironmentRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var environment = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["AGENTHUB_HOOK_URL"] = request.HookUrl,
            ["AGENTHUB_HOOK_TOKEN"] = request.HookToken,
            ["AGENTHUB_SESSION_ID"] = request.SessionId,
            ["AGENTHUB_RUN_ID"] = request.RunId,
            ["AGENTHUB_PROFILE_ID"] = request.ProfileId,
            ["AGENTHUB_WORKSPACE"] = request.Workspace,
            ["AGENTHUB_TEAM_ID"] = "default"
        };
        if (!string.IsNullOrWhiteSpace(request.HookLogPath))
        {
            environment["AGENTHUB_HOOK_LOG"] = request.HookLogPath;
        }

        return environment;
    }
}
