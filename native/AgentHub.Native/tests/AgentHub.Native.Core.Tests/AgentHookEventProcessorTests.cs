using AgentHub.Native.Core.Collaboration;
using AgentHub.Native.Core.Hooks;
using AgentHub.Native.Core.Input;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentHookEventProcessorTests : IDisposable
{
    private readonly string tempRoot = Path.Combine(Path.GetTempPath(), "agenthub-native-hook-processor", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Records_agent_output_dispatches_commands_and_records_forwarded_messages()
    {
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var target = new RecordingTerminalSession("codex-1");
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(target);
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", @"V:\OrderManager", DateTimeOffset.UtcNow));
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(inputRouter, registry));
        var processor = new AgentHookEventProcessor(store, dispatcher);

        var result = await processor.ProcessAsync(new AgentHookEvent(
            @"V:\OrderManager",
            "Done.\n<agenthub>{\"action\":\"send_message\",\"to\":\"codex\",\"message\":\"Please inspect.\"}</agenthub>",
            "claude",
            "claude-1",
            "run-1",
            "claude"));

        Assert.Equal(1, result.SentCount);
        Assert.Equal(["Please inspect.", "\r"], target.Writes);
        var events = await store.ListAsync(@"V:\OrderManager");
        Assert.Equal([CollaborationEventKind.AgentOutput, CollaborationEventKind.UserMessage], events.Select(item => item.Kind).ToArray());
        Assert.Equal("claude", events[0].ProfileId);
        Assert.Equal("agenthub", events[1].ProfileId);
        Assert.Equal("codex", events[1].TargetProfileId);
        Assert.Equal("Please inspect.", events[1].Message);
    }

    public void Dispose()
    {
        if (Directory.Exists(tempRoot))
        {
            Directory.Delete(tempRoot, recursive: true);
        }
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
