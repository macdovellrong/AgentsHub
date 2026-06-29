using AgentHub.Native.Core.Profiles;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentStartupCommandCatalogTests
{
    [Fact]
    public void Builds_codex_start_command()
    {
        var command = AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Start);

        Assert.Equal(AgentKind.Codex, command.AgentKind);
        Assert.Equal("codex", command.Command);
        Assert.Equal(["--no-alt-screen"], command.Arguments);
    }

    [Fact]
    public void Builds_codex_resume_command()
    {
        var command = AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Resume);

        Assert.Equal(AgentKind.Codex, command.AgentKind);
        Assert.Equal("codex", command.Command);
        Assert.Equal(["--no-alt-screen", "resume"], command.Arguments);
    }

    [Fact]
    public void Builds_terminal_scrollback_smoke_command()
    {
        var command = AgentStartupCommandCatalog.Build(AgentKind.ScrollTest, AgentStartupMode.Start);

        Assert.Equal(AgentKind.ScrollTest, command.AgentKind);
        Assert.Equal("powershell.exe", command.Command);
        Assert.Contains("-NoExit", command.Arguments);
        Assert.Contains("-Command", command.Arguments);
        Assert.Contains(command.Arguments, argument => argument.Contains("AgentHub scroll smoke line 240", StringComparison.Ordinal));
        Assert.Contains(command.Arguments, argument => argument.Contains("Use mouse wheel or touchpad to scroll up", StringComparison.Ordinal));
    }

    [Fact]
    public void Builds_managed_agent_start_commands_in_default_ui_order()
    {
        var commands = AgentStartupCommandCatalog.BuildManagedAgentStartCommands();

        Assert.Equal(
            [AgentKind.Codex, AgentKind.Claude, AgentKind.Gemini],
            commands.Select(command => command.AgentKind));
        Assert.Equal(["--no-alt-screen"], commands[0].Arguments);
        Assert.Empty(commands[1].Arguments);
        Assert.Empty(commands[2].Arguments);
    }

    [Fact]
    public void Builds_managed_agent_resume_commands_with_codex_resume_first()
    {
        var commands = AgentStartupCommandCatalog.BuildManagedAgentResumeCommands();

        Assert.Equal(
            [AgentKind.Codex, AgentKind.Claude, AgentKind.Gemini],
            commands.Select(command => command.AgentKind));
        Assert.Equal(["--no-alt-screen", "resume"], commands[0].Arguments);
        Assert.Empty(commands[1].Arguments);
        Assert.Empty(commands[2].Arguments);
    }

    [Theory]
    [InlineData(AgentKind.Codex, true)]
    [InlineData(AgentKind.Claude, true)]
    [InlineData(AgentKind.Gemini, true)]
    [InlineData(AgentKind.PowerShell, false)]
    [InlineData(AgentKind.ScrollTest, false)]
    public void Identifies_managed_agent_kinds(AgentKind agentKind, bool expected)
    {
        Assert.Equal(expected, AgentStartupCommandCatalog.IsManagedAgent(agentKind));
    }

    [Fact]
    public void Rejects_resume_for_agents_without_a_resume_preset()
    {
        var ex = Assert.Throws<NotSupportedException>(() =>
            AgentStartupCommandCatalog.Build(AgentKind.Claude, AgentStartupMode.Resume));

        Assert.Contains("Resume", ex.Message);
        Assert.Contains("Claude", ex.Message);
    }
}
