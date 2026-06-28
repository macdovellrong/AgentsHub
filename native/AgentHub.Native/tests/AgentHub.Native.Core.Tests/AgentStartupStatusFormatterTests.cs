using AgentHub.Native.Core.Profiles;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentStartupStatusFormatterTests
{
    [Fact]
    public void Formats_startup_failure_with_agent_name_and_error_message()
    {
        var status = AgentStartupStatusFormatter.FormatFailure(
            AgentKind.Codex,
            new DirectoryNotFoundException("AgentHub hook scripts not found."));

        Assert.Equal("Failed to start Codex: AgentHub hook scripts not found.", status);
    }

    [Fact]
    public void Formats_exception_without_message()
    {
        var status = AgentStartupStatusFormatter.FormatFailure(
            AgentKind.PowerShell,
            new EmptyMessageException());

        Assert.Equal("Failed to start PowerShell: EmptyMessageException", status);
    }

    private sealed class EmptyMessageException : InvalidOperationException
    {
        public override string Message => "";
    }
}
