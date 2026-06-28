using AgentHub.Native.Core.Collaboration;
using AgentHub.Native.Core.Input;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentHubCommandDispatcherTests
{
    [Fact]
    public async Task Dispatches_send_message_to_latest_target_profile_session()
    {
        var target = new RecordingTerminalSession("codex-1");
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(target);
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", @"V:\OrderManager", DateTimeOffset.UtcNow));
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(inputRouter, registry));

        var result = await dispatcher.DispatchAsync(
            @"v:\OrderManager\",
            "<agenthub>{\"action\":\"send_message\",\"to\":\"codex\",\"message\":\"Please inspect.\"}</agenthub>");

        Assert.Equal(1, result.SentCount);
        Assert.Empty(result.ParseErrors);
        Assert.Empty(result.DispatchErrors);
        var sent = Assert.Single(result.SentMessages);
        Assert.Equal("codex", sent.To);
        Assert.Equal("Please inspect.", sent.Message);
        Assert.Equal(["Please inspect.", "\r"], target.Writes);
    }

    [Fact]
    public async Task Dispatches_legacy_send_to_latest_target_profile_session()
    {
        var target = new RecordingTerminalSession("gemini-1");
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(target);
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("gemini-1", "gemini", @"V:\OrderManager", DateTimeOffset.UtcNow));
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(inputRouter, registry));

        var result = await dispatcher.DispatchAsync(
            @"V:\OrderManager",
            "<agenthub>{\"action\":\"send\",\"target\":\"gemini\",\"task_id\":\"T-002\",\"message\":\"Review this.\"}</agenthub>");

        Assert.Equal(1, result.SentCount);
        Assert.Empty(result.ParseErrors);
        Assert.Empty(result.DispatchErrors);
        Assert.Equal(["Review this.", "\r"], target.Writes);
    }

    [Theory]
    [InlineData("assign_task", "Implement T001")]
    [InlineData("reject_task", "Add tests")]
    [InlineData("request_review", "Review risk")]
    public async Task Dispatches_task_plan_routing_commands_to_latest_target_profile_session(
        string action,
        string expectedMessage)
    {
        var target = new RecordingTerminalSession("codex-1");
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(target);
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", @"V:\OrderManager", DateTimeOffset.UtcNow));
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(inputRouter, registry));

        var result = await dispatcher.DispatchAsync(
            @"V:\OrderManager",
            $"<agenthub>{{\"action\":\"{action}\",\"plan_id\":\"P001\",\"task_id\":\"T001\",\"to\":\"codex\",\"message\":\"{expectedMessage}\"}}</agenthub>");

        Assert.Equal(1, result.SentCount);
        Assert.Empty(result.ParseErrors);
        Assert.Empty(result.DispatchErrors);
        Assert.Equal([expectedMessage, "\r"], target.Writes);
    }

    [Fact]
    public async Task Reports_dispatch_error_when_target_profile_is_offline()
    {
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(new AgentInputRouter(), new AgentSessionRegistry()));

        var result = await dispatcher.DispatchAsync(
            @"V:\OrderManager",
            "<agenthub>{\"action\":\"send_message\",\"to\":\"codex\",\"message\":\"Please inspect.\"}</agenthub>");

        Assert.Equal(0, result.SentCount);
        Assert.Empty(result.ParseErrors);
        var error = Assert.Single(result.DispatchErrors);
        Assert.Equal("codex", error.TargetProfileId);
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
