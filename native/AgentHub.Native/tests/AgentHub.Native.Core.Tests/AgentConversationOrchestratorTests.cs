using AgentHub.Native.Core.Collaboration;
using AgentHub.Native.Core.Input;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentConversationOrchestratorTests : IDisposable
{
    private readonly string tempRoot = Path.Combine(
        Path.GetTempPath(),
        "agenthub-native-conversation-orchestrator",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Starts_manager_conversation_by_sending_prompt_to_latest_supervisor_session()
    {
        var workspacePath = CreateWorkspace();
        var conversationStore = new AgentConversationStore(new AgentConversationStoreOptions
        {
            UtcNow = () => DateTimeOffset.Parse("2026-06-29T12:34:56Z")
        });
        var timelineStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var inputRouter = new AgentInputRouter();
        var registry = new AgentSessionRegistry();
        var olderSession = new RecordingTerminalSession("claude-old");
        var latestSession = new RecordingTerminalSession("claude-latest");
        inputRouter.Register(olderSession);
        inputRouter.Register(latestSession);
        registry.Register(new AgentSessionDescriptor("claude-old", "claude", workspacePath, DateTimeOffset.Parse("2026-06-29T10:00:00Z")));
        registry.Register(new AgentSessionDescriptor("claude-latest", "claude", workspacePath, DateTimeOffset.Parse("2026-06-29T10:01:00Z")));
        var orchestrator = new AgentConversationOrchestrator(conversationStore, timelineStore, inputRouter, registry);

        var conversation = await orchestrator.StartManagerAsync(new StartAgentManagerConversationRequest(
            workspacePath,
            "Implement native orchestration",
            ["codex", "gemini"],
            ConversationId: "conversation-1"));

        Assert.Equal("conversation-1", conversation.Id);
        Assert.Equal("manager", conversation.Mode);
        Assert.Equal("running", conversation.Status);
        Assert.Equal("claude", conversation.SupervisorProfileId);
        Assert.Equal(["codex", "gemini"], conversation.ParticipantProfileIds);
        Assert.Equal(1, conversation.CurrentStep);
        Assert.Equal(12, conversation.MaxSteps);
        Assert.Empty(olderSession.Writes);
        Assert.Equal("\x1b[200~", latestSession.Writes[0]);
        Assert.Contains("AgentHub manager conversation.", latestSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Conversation: conversation-1", latestSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Topic: Implement native orchestration", latestSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Participants: codex, gemini", latestSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("<agenthub>{\"action\":\"send\"", latestSession.Writes[1], StringComparison.Ordinal);
        Assert.Equal("\x1b[201~", latestSession.Writes[2]);
        Assert.Equal("\r", latestSession.Writes[3]);
        var item = Assert.Single(await timelineStore.ListAsync(workspacePath));
        Assert.Equal(CollaborationEventKind.UserMessage, item.Kind);
        Assert.Equal("agenthub", item.ProfileId);
        Assert.Equal("claude", item.TargetProfileId);
        Assert.Equal("conversation-1", item.ConversationId);
        Assert.Contains("Manager conversation started", item.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Marks_manager_conversation_failed_when_supervisor_session_is_missing()
    {
        var workspacePath = CreateWorkspace();
        var conversationStore = new AgentConversationStore();
        var timelineStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var orchestrator = new AgentConversationOrchestrator(
            conversationStore,
            timelineStore,
            new AgentInputRouter(),
            new AgentSessionRegistry());

        var conversation = await orchestrator.StartManagerAsync(new StartAgentManagerConversationRequest(
            workspacePath,
            "Implement native orchestration",
            ["codex"],
            ConversationId: "conversation-1"));

        Assert.Equal("failed", conversation.Status);
        Assert.Equal(0, conversation.CurrentStep);
        var latest = Assert.Single(await conversationStore.ListAsync(workspacePath));
        Assert.Equal("failed", latest.Status);
        var item = Assert.Single(await timelineStore.ListAsync(workspacePath));
        Assert.Equal(CollaborationEventKind.AgentHubCommandError, item.Kind);
        Assert.Equal("conversation-1", item.ConversationId);
        Assert.Contains("No active session for profile 'claude'", item.Message, StringComparison.Ordinal);
    }

    public void Dispose()
    {
        if (Directory.Exists(tempRoot))
        {
            Directory.Delete(tempRoot, recursive: true);
        }
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
