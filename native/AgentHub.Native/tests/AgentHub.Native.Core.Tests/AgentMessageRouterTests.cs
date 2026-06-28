using AgentHub.Native.Core.Collaboration;
using AgentHub.Native.Core.Input;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentMessageRouterTests
{
    [Fact]
    public async Task Sends_message_to_latest_session_for_profile_in_workspace()
    {
        var session = new RecordingTerminalSession("codex-2");
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(session);
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", @"V:\OrderManager", DateTimeOffset.Parse("2026-06-29T10:00:00Z")));
        registry.Register(new AgentSessionDescriptor("codex-2", "codex", @"V:\OrderManager", DateTimeOffset.Parse("2026-06-29T10:01:00Z")));
        var router = new AgentMessageRouter(inputRouter, registry);

        await router.SendToProfileAsync(@"v:\OrderManager\", "CODEX", "please review");

        Assert.Equal(["please review", "\r"], session.Writes);
    }

    [Fact]
    public async Task Throws_when_target_profile_has_no_session()
    {
        var router = new AgentMessageRouter(new AgentInputRouter(), new AgentSessionRegistry());

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            router.SendToProfileAsync(@"V:\OrderManager", "codex", "hello"));
    }

    private sealed class RecordingTerminalSession(string id) : IAgentTerminalSession
    {
        public string Id { get; } = id;
        public List<string> Writes { get; } = [];

        public Task WriteAsync(string text, CancellationToken cancellationToken = default)
        {
            Writes.Add(text);
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken = default)
        {
            return Task.CompletedTask;
        }
    }
}
