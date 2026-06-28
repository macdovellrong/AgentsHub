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

    [Fact]
    public async Task Try_send_returns_false_when_target_profile_has_no_session()
    {
        var router = new AgentMessageRouter(new AgentInputRouter(), new AgentSessionRegistry());

        var sent = await router.TrySendToProfileAsync(@"V:\OrderManager", "codex", "hello");

        Assert.False(sent);
    }

    [Fact]
    public async Task Try_send_detailed_reports_offline_when_target_profile_has_no_session()
    {
        var router = new AgentMessageRouter(new AgentInputRouter(), new AgentSessionRegistry());

        var result = await router.TrySendToProfileDetailedAsync(@"V:\OrderManager", "codex", "hello");

        Assert.Equal(AgentMessageSendStatus.ProfileOffline, result.Status);
        Assert.False(result.Sent);
    }

    [Fact]
    public async Task Try_send_returns_true_after_sending_to_latest_session()
    {
        var session = new RecordingTerminalSession("codex-2");
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(session);
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-2", "codex", @"V:\OrderManager", DateTimeOffset.UtcNow));
        var router = new AgentMessageRouter(inputRouter, registry);

        var sent = await router.TrySendToProfileAsync(@"V:\OrderManager", "codex", "please review");

        Assert.True(sent);
        Assert.Equal(["please review", "\r"], session.Writes);
    }

    [Fact]
    public async Task Try_send_returns_false_and_removes_stale_session_when_terminal_is_missing()
    {
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", @"V:\OrderManager", DateTimeOffset.UtcNow));
        var router = new AgentMessageRouter(new AgentInputRouter(), registry);

        var sent = await router.TrySendToProfileAsync(@"V:\OrderManager", "codex", "please review");

        Assert.False(sent);
        Assert.Null(registry.FindLatest(@"V:\OrderManager", "codex"));
    }

    [Fact]
    public async Task Try_send_returns_false_and_keeps_session_when_terminal_is_not_ready()
    {
        var session = new NotReadyTerminalSession("codex-1");
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(session);
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", @"V:\OrderManager", DateTimeOffset.UtcNow));
        var router = new AgentMessageRouter(inputRouter, registry);

        var sent = await router.TrySendToProfileAsync(@"V:\OrderManager", "codex", "please review");

        Assert.False(sent);
        Assert.NotNull(registry.FindLatest(@"V:\OrderManager", "codex"));
    }

    [Fact]
    public async Task Try_send_detailed_reports_not_ready_and_keeps_session()
    {
        var session = new NotReadyTerminalSession("codex-1");
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(session);
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", @"V:\OrderManager", DateTimeOffset.UtcNow));
        var router = new AgentMessageRouter(inputRouter, registry);

        var result = await router.TrySendToProfileDetailedAsync(@"V:\OrderManager", "codex", "please review");

        Assert.Equal(AgentMessageSendStatus.TerminalNotReady, result.Status);
        Assert.False(result.Sent);
        Assert.NotNull(registry.FindLatest(@"V:\OrderManager", "codex"));
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

    private sealed class NotReadyTerminalSession(string id) : IAgentTerminalSession
    {
        public string Id { get; } = id;

        public Task WriteAsync(string text, CancellationToken cancellationToken = default)
        {
            throw new AgentTerminalNotReadyException("terminal is still starting");
        }

        public Task StopAsync(CancellationToken cancellationToken = default)
        {
            return Task.CompletedTask;
        }
    }
}
