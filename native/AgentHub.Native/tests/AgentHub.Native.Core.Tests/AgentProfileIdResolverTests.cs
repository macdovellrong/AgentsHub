using AgentHub.Native.Core.Profiles;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentProfileIdResolverTests
{
    [Theory]
    [InlineData(AgentKind.Codex, ShellKind.PowerShell, "codex")]
    [InlineData(AgentKind.Codex, ShellKind.Cmd, "codex")]
    [InlineData(AgentKind.Claude, ShellKind.PowerShell, "claude")]
    [InlineData(AgentKind.Gemini, ShellKind.PowerShell, "gemini")]
    [InlineData(AgentKind.PowerShell, ShellKind.PowerShell, "powershell")]
    [InlineData(AgentKind.PowerShell, ShellKind.Cmd, "cmd")]
    [InlineData(AgentKind.ScrollTest, ShellKind.PowerShell, "scrolltest")]
    [InlineData(AgentKind.ScrollTest, ShellKind.Cmd, "scrolltest")]
    public void Resolves_profile_id_from_agent_and_shell_kind(
        AgentKind agentKind,
        ShellKind shellKind,
        string expectedProfileId)
    {
        Assert.Equal(expectedProfileId, AgentProfileIdResolver.Resolve(agentKind, shellKind));
    }
}
