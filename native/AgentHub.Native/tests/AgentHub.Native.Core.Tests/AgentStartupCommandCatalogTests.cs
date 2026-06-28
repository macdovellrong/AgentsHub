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
        Assert.Empty(command.Arguments);
    }

    [Fact]
    public void Builds_codex_resume_command()
    {
        var command = AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Resume);

        Assert.Equal(AgentKind.Codex, command.AgentKind);
        Assert.Equal("codex", command.Command);
        Assert.Equal(["resume"], command.Arguments);
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
