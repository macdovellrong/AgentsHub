using AgentHub.Native.Core.Collaboration;
using AgentHub.Native.Core.Hooks;
using AgentHub.Native.Core.Input;
using AgentHub.Native.Core.TaskPlans;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentHookProcessingPipelineTests : IDisposable
{
    private readonly string tempRoot = Path.Combine(
        Path.GetTempPath(),
        "agenthub-native-hook-pipeline",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Routes_conversation_hook_through_conversation_orchestrator_without_generic_dispatch()
    {
        var workspacePath = CreateWorkspace();
        var eventStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var inputRouter = new AgentInputRouter();
        var registry = new AgentSessionRegistry();
        var targetSession = new RecordingTerminalSession("codex-1");
        inputRouter.Register(targetSession);
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", workspacePath, DateTimeOffset.Parse("2026-06-29T10:02:00Z")));
        var conversationStore = new AgentConversationStore();
        await conversationStore.CreateAsync(
            workspacePath,
            new CreateAgentConversationRequest(
                "conversation-1",
                "manager",
                "claude",
                ["codex"],
                "Implement native orchestration",
                CurrentStep: 1,
                MaxSteps: 12));
        var pipeline = CreatePipeline(eventStore, inputRouter, registry, conversationStore);

        var result = await pipeline.ProcessAsync(new AgentHookEvent(
            workspacePath,
            "<agenthub>{\"action\":\"send\",\"target\":\"codex\",\"task_id\":\"T-001\",\"message\":\"Implement parser.\"}</agenthub>",
            "claude",
            "claude-1",
            "run-1",
            "claude",
            ConversationId: "conversation-1"));

        Assert.Equal(0, result.SentCount);
        Assert.NotNull(result.SourceEventId);
        Assert.Equal("\x1b[200~", targetSession.Writes[0]);
        Assert.Contains("AgentHub delegated task.", targetSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Conversation: conversation-1", targetSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Task: T-001", targetSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Implement parser.", targetSession.Writes[1], StringComparison.Ordinal);
        Assert.Equal("\x1b[201~", targetSession.Writes[2]);
        Assert.Equal("\r", targetSession.Writes[3]);
        Assert.Equal(4, targetSession.Writes.Count);
        var events = await eventStore.ListAsync(workspacePath);
        Assert.Equal(2, events.Count);
        Assert.Equal(CollaborationEventKind.AgentOutput, events[0].Kind);
        Assert.Equal(CollaborationEventKind.UserMessage, events[1].Kind);
        Assert.Equal("conversation-1", events[1].ConversationId);
        Assert.Equal("T-001", events[1].TaskId);
    }

    [Fact]
    public async Task Routes_non_conversation_hook_through_generic_dispatcher()
    {
        var workspacePath = CreateWorkspace();
        var eventStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var inputRouter = new AgentInputRouter();
        var registry = new AgentSessionRegistry();
        var targetSession = new RecordingTerminalSession("codex-1");
        inputRouter.Register(targetSession);
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", workspacePath, DateTimeOffset.Parse("2026-06-29T10:02:00Z")));
        var pipeline = CreatePipeline(eventStore, inputRouter, registry, new AgentConversationStore());

        var result = await pipeline.ProcessAsync(new AgentHookEvent(
            workspacePath,
            "<agenthub>{\"action\":\"send_message\",\"to\":\"codex\",\"message\":\"Ping\"}</agenthub>",
            "claude",
            "claude-1",
            "run-1",
            "claude"));

        Assert.Equal(1, result.SentCount);
        Assert.NotNull(result.SourceEventId);
        Assert.Equal(["Ping", "\r"], targetSession.Writes);
        var events = await eventStore.ListAsync(workspacePath);
        Assert.Equal(2, events.Count);
        Assert.Equal(CollaborationEventKind.AgentOutput, events[0].Kind);
        Assert.Equal(CollaborationEventKind.UserMessage, events[1].Kind);
        Assert.Equal("codex", events[1].TargetProfileId);
        Assert.Equal("Ping", events[1].Message);
    }

    public void Dispose()
    {
        if (Directory.Exists(tempRoot))
        {
            Directory.Delete(tempRoot, recursive: true);
        }
    }

    private AgentHookProcessingPipeline CreatePipeline(
        CollaborationEventStore eventStore,
        AgentInputRouter inputRouter,
        AgentSessionRegistry registry,
        AgentConversationStore conversationStore)
    {
        var taskPlanStore = new AgentTaskPlanStore();
        return new AgentHookProcessingPipeline(
            eventStore,
            new AgentHookEventProcessor(
                eventStore,
                new AgentHubCommandDispatcher(new AgentMessageRouter(inputRouter, registry)),
                new AgentTeamStore(),
                new AgentTaskStore(),
                new AgentTaskPlanEventStore()),
            new AgentTaskPlanService(taskPlanStore, eventStore, inputRouter, registry),
            new AgentConversationOrchestrator(conversationStore, eventStore, inputRouter, registry));
    }

    private string CreateWorkspace()
    {
        var workspacePath = Path.Combine(tempRoot, "workspace-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workspacePath);
        return workspacePath;
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
