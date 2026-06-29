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
    public async Task Dispatches_send_message_to_managed_agent_group()
    {
        var codex = new RecordingTerminalSession("codex-1");
        var claude = new RecordingTerminalSession("claude-1");
        var gemini = new RecordingTerminalSession("gemini-1");
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(codex);
        inputRouter.Register(claude);
        inputRouter.Register(gemini);
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", @"V:\OrderManager", DateTimeOffset.UtcNow));
        registry.Register(new AgentSessionDescriptor("claude-1", "claude", @"V:\OrderManager", DateTimeOffset.UtcNow));
        registry.Register(new AgentSessionDescriptor("gemini-1", "gemini", @"V:\OrderManager", DateTimeOffset.UtcNow));
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(inputRouter, registry));

        var result = await dispatcher.DispatchAsync(
            @"v:\OrderManager\",
            "<agenthub>{\"action\":\"send_message\",\"to\":\"agents\",\"message\":\"Sync status.\"}</agenthub>");

        Assert.Equal(3, result.SentCount);
        Assert.Empty(result.ParseErrors);
        Assert.Empty(result.DispatchErrors);
        Assert.Equal(["codex", "claude", "gemini"], result.SentMessages.Select(item => item.To).ToArray());
        Assert.Equal(["Sync status.", "\r"], codex.Writes);
        Assert.Equal(["Sync status.", "\r"], claude.Writes);
        Assert.Equal(["Sync status.", "\r"], gemini.Writes);
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
    [InlineData("assign_task", "AgentHub task-plan delegated task.")]
    [InlineData("reject_task", "AgentHub task-plan delegated task.")]
    [InlineData("request_review", "AgentHub task-plan review request.")]
    public async Task Dispatches_task_plan_routing_commands_as_plan_aware_prompts(
        string action,
        string expectedHeader)
    {
        var target = new RecordingTerminalSession("codex-1");
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(target);
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", @"V:\OrderManager", DateTimeOffset.UtcNow));
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(inputRouter, registry));

        var result = await dispatcher.DispatchAsync(
            @"V:\OrderManager",
            $"<agenthub>{{\"action\":\"{action}\",\"plan_id\":\"P001\",\"task_id\":\"T001\",\"to\":\"codex\",\"message\":\"Implement T001\"}}</agenthub>");

        Assert.Equal(1, result.SentCount);
        Assert.Empty(result.ParseErrors);
        Assert.Empty(result.DispatchErrors);
        Assert.Equal("\x1b[200~", target.Writes[0]);
        Assert.Contains(expectedHeader, target.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Plan: P001", target.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Task: T001", target.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Implement T001", target.Writes[1], StringComparison.Ordinal);
        Assert.Equal("\x1b[201~", target.Writes[2]);
        Assert.Equal("\r", target.Writes[3]);
        var sent = Assert.Single(result.SentMessages);
        Assert.Equal("Implement T001", sent.Message);
    }

    [Fact]
    public async Task Accepts_task_plan_status_commands_without_terminal_dispatch()
    {
        var target = new RecordingTerminalSession("codex-1");
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(target);
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", @"V:\OrderManager", DateTimeOffset.UtcNow));
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(inputRouter, registry));

        var result = await dispatcher.DispatchAsync(
            @"V:\OrderManager",
            "<agenthub>{\"action\":\"approve_task\",\"plan_id\":\"P001\",\"task_id\":\"T001\",\"summary\":\"Looks good\"}</agenthub>\n" +
            "<agenthub>{\"action\":\"pause_plan\",\"plan_id\":\"P001\",\"reason\":\"Need user decision\"}</agenthub>");

        Assert.Equal(0, result.SentCount);
        Assert.Empty(result.ParseErrors);
        Assert.Empty(result.DispatchErrors);
        Assert.Empty(result.SentMessages);
        Assert.Empty(target.Writes);
        Assert.Collection(
            result.PlanStatusCommands,
            command => Assert.Equal("approve_task", command.Action),
            command => Assert.Equal("pause_plan", command.Action));
    }

    [Fact]
    public async Task Dispatches_pair_negotiation_continue_with_message_to_to_latest_target_profile_session()
    {
        var target = new RecordingTerminalSession("codex-1");
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(target);
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", @"V:\OrderManager", DateTimeOffset.UtcNow));
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(inputRouter, registry));

        var result = await dispatcher.DispatchAsync(
            @"V:\OrderManager",
            "<agenthub>{\"action\":\"continue\",\"proposal_version\":2,\"message\":\"Please review version 2.\",\"message_to\":\"codex\",\"summary\":\"Version 2 adds tests.\"}</agenthub>");

        Assert.Equal(1, result.SentCount);
        Assert.Empty(result.ParseErrors);
        Assert.Empty(result.DispatchErrors);
        Assert.Empty(result.SentMessages);
        Assert.Equal(["Please review version 2.", "\r"], target.Writes);
        var command = Assert.Single(result.PairNegotiationCommands);
        Assert.Equal("continue", command.Action);
        Assert.Equal("codex", command.MessageTo);
        Assert.Equal("Please review version 2.", command.DispatchMessage);
        Assert.Equal("codex-1", command.SessionId);
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

    [Fact]
    public async Task Reports_dispatch_error_when_target_terminal_is_not_ready()
    {
        var target = new NotReadyTerminalSession("codex-1");
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(target);
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", @"V:\OrderManager", DateTimeOffset.UtcNow));
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(inputRouter, registry));

        var result = await dispatcher.DispatchAsync(
            @"V:\OrderManager",
            "<agenthub>{\"action\":\"send_message\",\"to\":\"codex\",\"message\":\"Please inspect.\"}</agenthub>");

        Assert.Equal(0, result.SentCount);
        Assert.Empty(result.ParseErrors);
        var error = Assert.Single(result.DispatchErrors);
        Assert.Equal("codex", error.TargetProfileId);
        Assert.Contains("still starting", error.Message);
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
