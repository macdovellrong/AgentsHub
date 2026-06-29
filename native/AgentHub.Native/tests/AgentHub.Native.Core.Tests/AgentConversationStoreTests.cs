using AgentHub.Native.Core.Collaboration;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentConversationStoreTests : IDisposable
{
    private readonly string tempRoot = Path.Combine(
        Path.GetTempPath(),
        "agenthub-native-conversations",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Creates_updates_and_lists_latest_conversations()
    {
        var store = new AgentConversationStore(new AgentConversationStoreOptions
        {
            UtcNow = () => DateTimeOffset.Parse("2026-06-29T12:34:56Z")
        });
        var workspacePath = CreateWorkspace();

        var created = await store.CreateAsync(workspacePath, new CreateAgentConversationRequest(
            "conversation-1",
            "manager",
            "claude",
            ["codex", "gemini"],
            "Implement native orchestration",
            MaxSteps: 12));
        var updated = await store.UpdateAsync(workspacePath, created.Id, new UpdateAgentConversationRequest(
            Status: "paused",
            CurrentStep: 2,
            UpdatedAt: DateTimeOffset.Parse("2026-06-29T12:35:56Z")));

        Assert.Equal("conversation-1", created.Id);
        Assert.Equal("running", created.Status);
        Assert.Equal("paused", updated.Status);
        Assert.Equal(2, updated.CurrentStep);
        Assert.Equal(DateTimeOffset.Parse("2026-06-29T12:34:56Z"), created.CreatedAt);
        Assert.Equal(DateTimeOffset.Parse("2026-06-29T12:35:56Z"), updated.UpdatedAt);
        var latest = Assert.Single(await store.ListAsync(workspacePath));
        Assert.Equal(updated.Id, latest.Id);
        Assert.Equal(updated.Status, latest.Status);
        Assert.Equal(updated.CurrentStep, latest.CurrentStep);
        Assert.Equal(updated.UpdatedAt, latest.UpdatedAt);
    }

    [Fact]
    public async Task Lists_latest_conversations_by_updated_at_descending()
    {
        var store = new AgentConversationStore();
        var workspacePath = CreateWorkspace();

        await store.CreateAsync(workspacePath, new CreateAgentConversationRequest(
            "older",
            "roundtable",
            null,
            ["claude", "codex"],
            "Older topic",
            CreatedAt: DateTimeOffset.Parse("2026-06-29T10:00:00Z"),
            UpdatedAt: DateTimeOffset.Parse("2026-06-29T10:00:00Z")));
        await store.CreateAsync(workspacePath, new CreateAgentConversationRequest(
            "newer",
            "pair_negotiation",
            null,
            ["claude", "codex"],
            "Newer topic",
            CreatedAt: DateTimeOffset.Parse("2026-06-29T11:00:00Z"),
            UpdatedAt: DateTimeOffset.Parse("2026-06-29T11:00:00Z")));

        var conversations = await store.ListAsync(workspacePath);

        Assert.Equal(["newer", "older"], conversations.Select(item => item.Id).ToArray());
    }

    [Fact]
    public async Task Rejects_duplicate_ids_and_unknown_updates()
    {
        var store = new AgentConversationStore();
        var workspacePath = CreateWorkspace();
        var request = new CreateAgentConversationRequest(
            "conversation-1",
            "manager",
            "claude",
            ["codex"],
            "Implement native orchestration");

        await store.CreateAsync(workspacePath, request);

        await Assert.ThrowsAsync<InvalidOperationException>(() => store.CreateAsync(workspacePath, request));
        await Assert.ThrowsAsync<InvalidOperationException>(() => store.UpdateAsync(
            workspacePath,
            "missing",
            new UpdateAgentConversationRequest(Status: "paused")));
    }

    [Fact]
    public async Task Skips_invalid_jsonl_lines()
    {
        var store = new AgentConversationStore();
        var workspacePath = CreateWorkspace();
        await store.CreateAsync(workspacePath, new CreateAgentConversationRequest(
            "conversation-1",
            "manager",
            "claude",
            ["codex"],
            "Implement native orchestration"));
        var filePath = Path.Combine(workspacePath, ".agenthub", "conversations", "conversations.jsonl");
        await File.AppendAllTextAsync(filePath, "{ broken json\n\n");

        var item = Assert.Single(await store.ListAsync(workspacePath));

        Assert.Equal("conversation-1", item.Id);
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
}
