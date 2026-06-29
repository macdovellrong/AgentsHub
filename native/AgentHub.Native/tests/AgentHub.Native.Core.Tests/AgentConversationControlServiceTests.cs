using AgentHub.Native.Core.Collaboration;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentConversationControlServiceTests : IDisposable
{
    private readonly string tempRoot = Path.Combine(
        Path.GetTempPath(),
        "agenthub-native-conversation-control",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Pauses_running_conversation_and_records_timeline_event()
    {
        var store = CreateStore();
        var timeline = CreateTimelineStore();
        var workspacePath = CreateWorkspace();
        await store.CreateAsync(workspacePath, new CreateAgentConversationRequest(
            "conversation-1",
            "manager",
            "claude",
            ["codex"],
            "Coordinate Codex work"));
        var service = new AgentConversationControlService(store, timeline);

        var updated = await service.PauseAsync(workspacePath, "conversation-1", "Need user decision");

        Assert.Equal("paused", updated.Status);
        Assert.Equal("paused", Assert.Single(await store.ListAsync(workspacePath)).Status);
        var item = Assert.Single(await timeline.ListAsync(workspacePath));
        Assert.Equal("conversation-1", item.ConversationId);
        Assert.Equal("agenthub", item.ProfileId);
        Assert.Equal("conversation", item.TargetProfileId);
        Assert.Equal("[pause_conversation] Need user decision", item.Message);
    }

    [Fact]
    public async Task Resumes_paused_conversation_and_records_timeline_event()
    {
        var store = CreateStore();
        var timeline = CreateTimelineStore();
        var workspacePath = CreateWorkspace();
        await store.CreateAsync(workspacePath, new CreateAgentConversationRequest(
            "conversation-1",
            "roundtable",
            null,
            ["claude", "codex"],
            "Compare options",
            Status: "paused"));
        var service = new AgentConversationControlService(store, timeline);

        var updated = await service.ResumeAsync(workspacePath, "conversation-1", "User resumed");

        Assert.Equal("running", updated.Status);
        var item = Assert.Single(await timeline.ListAsync(workspacePath));
        Assert.Equal("[resume_conversation] User resumed", item.Message);
    }

    [Fact]
    public async Task Stops_active_conversation_and_records_timeline_event()
    {
        var store = CreateStore();
        var timeline = CreateTimelineStore();
        var workspacePath = CreateWorkspace();
        await store.CreateAsync(workspacePath, new CreateAgentConversationRequest(
            "conversation-1",
            "pair_negotiation",
            null,
            ["claude", "codex"],
            "Negotiate implementation"));
        var service = new AgentConversationControlService(store, timeline);

        var updated = await service.StopAsync(workspacePath, "conversation-1", "Stopped by user");

        Assert.Equal("stopped", updated.Status);
        var item = Assert.Single(await timeline.ListAsync(workspacePath));
        Assert.Equal("[stop_conversation] Stopped by user", item.Message);
    }

    [Fact]
    public async Task Rejects_resume_for_completed_conversation()
    {
        var store = CreateStore();
        var timeline = CreateTimelineStore();
        var workspacePath = CreateWorkspace();
        await store.CreateAsync(workspacePath, new CreateAgentConversationRequest(
            "conversation-1",
            "manager",
            "claude",
            ["codex"],
            "Done",
            Status: "completed"));
        var service = new AgentConversationControlService(store, timeline);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.ResumeAsync(workspacePath, "conversation-1", "User resumed"));

        Assert.Contains("Cannot resume conversation", ex.Message, StringComparison.Ordinal);
        Assert.Equal("completed", Assert.Single(await store.ListAsync(workspacePath)).Status);
        Assert.Empty(await timeline.ListAsync(workspacePath));
    }

    public void Dispose()
    {
        if (Directory.Exists(tempRoot))
        {
            Directory.Delete(tempRoot, recursive: true);
        }
    }

    private AgentConversationStore CreateStore()
    {
        return new AgentConversationStore(new AgentConversationStoreOptions
        {
            UtcNow = () => DateTimeOffset.Parse("2026-06-29T12:34:56Z")
        });
    }

    private CollaborationEventStore CreateTimelineStore()
    {
        return new CollaborationEventStore(Path.Combine(tempRoot, "events"));
    }

    private string CreateWorkspace()
    {
        var workspacePath = Path.Combine(tempRoot, "workspace-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workspacePath);
        return workspacePath;
    }

}
