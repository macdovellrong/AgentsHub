using AgentHub.Native.Core.Profiles;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentLaunchPlanBuilderTests
{
    [Fact]
    public void Builds_codex_plan_hosted_by_powershell_in_workspace()
    {
        var plan = AgentLaunchPlanBuilder.Build(new AgentLaunchRequest(
            AgentKind.Codex,
            ShellKind.PowerShell,
            @"V:\OrderManager",
            "codex",
            ["resume"]));

        Assert.Equal(AgentKind.Codex, plan.AgentKind);
        Assert.Equal(ShellKind.PowerShell, plan.ShellKind);
        Assert.Equal(@"V:\OrderManager", plan.WorkingDirectory);
        Assert.EndsWith(@"\powershell.exe", plan.Executable, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("-NoLogo", plan.Arguments);
        Assert.Contains("-NoExit", plan.Arguments);
        Assert.Contains("Set-Location -LiteralPath 'V:\\OrderManager'", plan.CommandText);
        Assert.Contains("& 'codex' 'resume'", plan.CommandText);
    }

    [Fact]
    public void Injects_hook_environment_before_launching_agent()
    {
        var plan = AgentLaunchPlanBuilder.Build(new AgentLaunchRequest(
            AgentKind.Codex,
            ShellKind.PowerShell,
            @"V:\OrderManager",
            "codex",
            [],
            new Dictionary<string, string>
            {
                ["AGENTHUB_HOOK_URL"] = "http://127.0.0.1:17321/api/agent-result",
                ["AGENTHUB_HOOK_TOKEN"] = "token'1"
            }));

        Assert.Contains("$env:AGENTHUB_HOOK_URL = 'http://127.0.0.1:17321/api/agent-result'", plan.CommandText);
        Assert.Contains("$env:AGENTHUB_HOOK_TOKEN = 'token''1'", plan.CommandText);
        Assert.True(plan.CommandText.IndexOf("$env:AGENTHUB_HOOK_URL", StringComparison.Ordinal) <
                    plan.CommandText.IndexOf("& 'codex'", StringComparison.Ordinal));
    }

    [Fact]
    public void Builds_cmd_plan_for_plain_powerShell_free_sessions()
    {
        var plan = AgentLaunchPlanBuilder.Build(new AgentLaunchRequest(
            AgentKind.PowerShell,
            ShellKind.Cmd,
            @"D:\Repo",
            "cmd.exe",
            []));

        Assert.Equal(ShellKind.Cmd, plan.ShellKind);
        Assert.EndsWith(@"\cmd.exe", plan.Executable, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(["/K", "cd /d \"D:\\Repo\""], plan.Arguments);
        Assert.Equal("cd /d \"D:\\Repo\"", plan.CommandText);
    }

    [Fact]
    public void Injects_hook_environment_before_launching_agent_in_cmd()
    {
        var plan = AgentLaunchPlanBuilder.Build(new AgentLaunchRequest(
            AgentKind.Codex,
            ShellKind.Cmd,
            @"V:\OrderManager",
            "codex",
            ["resume"],
            new Dictionary<string, string>
            {
                ["AGENTHUB_HOOK_TOKEN"] = "token&1",
                ["AGENTHUB_HOOK_URL"] = "http://127.0.0.1:17321/api/agent-result"
            }));

        Assert.Equal(
            "set \"AGENTHUB_HOOK_TOKEN=token&1\" && set \"AGENTHUB_HOOK_URL=http://127.0.0.1:17321/api/agent-result\" && cd /d \"V:\\OrderManager\" && \"codex\" \"resume\"",
            plan.CommandText);
    }

    [Fact]
    public void Builds_interactive_cmd_plan_when_command_is_empty()
    {
        var plan = AgentLaunchPlanBuilder.Build(new AgentLaunchRequest(
            AgentKind.PowerShell,
            ShellKind.Cmd,
            @"D:\Repo",
            "",
            []));

        Assert.Equal("cd /d \"D:\\Repo\"", plan.CommandText);
    }
}
