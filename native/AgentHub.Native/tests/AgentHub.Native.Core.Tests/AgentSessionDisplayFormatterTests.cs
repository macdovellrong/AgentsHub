using AgentHub.Native.Core.Collaboration;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentSessionDisplayFormatterTests
{
    [Fact]
    public void Formats_session_with_profile_workspace_run_and_hook_receiver()
    {
        var session = new AgentSessionDescriptor(
            "codex-1",
            "codex",
            @"V:\OrderManager",
            new DateTimeOffset(2026, 6, 29, 12, 30, 0, TimeSpan.Zero),
            "codex-1-20260629123000",
            "http://127.0.0.1:49152/");

        var text = AgentSessionDisplayFormatter.Format(session);

        Assert.Equal(
            "codex-1 | profile=codex | workspace=V:\\OrderManager | run=codex-1-20260629123000 | hook=http://127.0.0.1:49152/",
            text);
    }

    [Fact]
    public void Formats_missing_run_and_hook_receiver_as_unavailable()
    {
        var session = new AgentSessionDescriptor(
            "powershell-1",
            "powershell",
            @"V:\OrderManager",
            new DateTimeOffset(2026, 6, 29, 12, 30, 0, TimeSpan.Zero));

        var text = AgentSessionDisplayFormatter.Format(session);

        Assert.Equal(
            "powershell-1 | profile=powershell | workspace=V:\\OrderManager | run=untracked | hook=unavailable",
            text);
    }
}
