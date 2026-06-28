using AgentHub.Native.Core.Hooks;

namespace AgentHub.Native.Core.Tests;

public sealed class HookEnvironmentBuilderTests
{
    [Fact]
    public void Builds_agenthub_hook_environment_for_session()
    {
        var env = HookEnvironmentBuilder.Build(new HookEnvironmentRequest(
            "http://127.0.0.1:17321/api/agent-result",
            "token-1",
            "session-1",
            "run-1",
            "codex",
            @"V:\OrderManager"));

        Assert.Equal("http://127.0.0.1:17321/api/agent-result", env["AGENTHUB_HOOK_URL"]);
        Assert.Equal("token-1", env["AGENTHUB_HOOK_TOKEN"]);
        Assert.Equal("session-1", env["AGENTHUB_SESSION_ID"]);
        Assert.Equal("run-1", env["AGENTHUB_RUN_ID"]);
        Assert.Equal("codex", env["AGENTHUB_PROFILE_ID"]);
        Assert.Equal(@"V:\OrderManager", env["AGENTHUB_WORKSPACE"]);
        Assert.Equal("default", env["AGENTHUB_TEAM_ID"]);
    }

    [Fact]
    public void Includes_explicit_hook_diagnostic_log_path()
    {
        var request = new HookEnvironmentRequest(
            "http://127.0.0.1:17321/api/agent-result",
            "token-1",
            "session-1",
            "run-1",
            "codex",
            @"V:\OrderManager") with
        {
            HookLogPath = @"C:\Users\saber\AppData\Local\AgentHub\Native\hooks.jsonl"
        };

        var env = HookEnvironmentBuilder.Build(request);

        Assert.Equal(@"C:\Users\saber\AppData\Local\AgentHub\Native\hooks.jsonl", env["AGENTHUB_HOOK_LOG"]);
    }
}
