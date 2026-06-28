using AgentHub.Native.Core.Collaboration;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentSessionRegistryTests
{
    [Fact]
    public void Finds_latest_session_by_workspace_and_profile()
    {
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", @"V:\OrderManager", DateTimeOffset.Parse("2026-06-29T10:00:00Z")));
        registry.Register(new AgentSessionDescriptor("codex-2", "codex", @"v:\OrderManager\", DateTimeOffset.Parse("2026-06-29T10:01:00Z")));
        registry.Register(new AgentSessionDescriptor("claude-1", "claude", @"V:\OrderManager", DateTimeOffset.Parse("2026-06-29T10:02:00Z")));

        var session = registry.FindLatest(@"V:\OrderManager", "codex");

        Assert.NotNull(session);
        Assert.Equal("codex-2", session.Id);
    }

    [Fact]
    public void Removes_session_by_id()
    {
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", @"V:\OrderManager", DateTimeOffset.UtcNow));

        registry.Remove("codex-1");

        Assert.Null(registry.FindLatest(@"V:\OrderManager", "codex"));
    }
}
