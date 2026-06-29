using AgentHub.Native.Core.Collaboration;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentConversationArtifactStoreTests : IDisposable
{
    private readonly string tempRoot = Path.Combine(
        Path.GetTempPath(),
        "agenthub-native-conversation-artifacts",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Initializes_pair_conversation_files()
    {
        var workspacePath = CreateWorkspace();
        var store = new AgentConversationArtifactStore();

        var paths = await store.InitializePairConversationAsync(
            workspacePath,
            new PairConversationArtifactInput(
                "conversation-1",
                "Decide native terminal architecture",
                ["claude", "codex"],
                6));

        Assert.Equal(".agenthub/conversations/conversation-1", paths.ConversationRoot);
        Assert.Equal(".agenthub/conversations/conversation-1/brief.md", paths.BriefPath);
        Assert.Equal(".agenthub/conversations/conversation-1/memory.md", paths.MemoryPath);
        Assert.Equal(".agenthub/conversations/conversation-1/state.json", paths.StatePath);
        Assert.Equal(".agenthub/conversations/conversation-1/turns", paths.TurnsPath);
        Assert.Contains(
            "Decide native terminal architecture",
            await File.ReadAllTextAsync(Path.Combine(workspacePath, paths.BriefPath)));
        Assert.Contains(
            "Conversation Memory",
            await File.ReadAllTextAsync(Path.Combine(workspacePath, paths.MemoryPath)));
        Assert.Contains(
            "\"conversationId\": \"conversation-1\"",
            await File.ReadAllTextAsync(Path.Combine(workspacePath, paths.StatePath)));
        Assert.True(Directory.Exists(Path.Combine(workspacePath, paths.TurnsPath)));
    }

    [Fact]
    public void Allocates_stable_turn_artifact_paths_with_safe_profile_ids()
    {
        var store = new AgentConversationArtifactStore();

        Assert.Equal(
            ".agenthub/conversations/conversation-1/turns/0001-claude.md",
            store.TurnArtifactPath("conversation-1", 1, "claude"));
        Assert.Equal(
            ".agenthub/conversations/conversation-1/turns/0012-codex-writer.md",
            store.TurnArtifactPath("conversation-1", 12, "codex.writer"));
    }

    [Fact]
    public async Task Validates_existing_turn_artifact_and_rejects_unsafe_paths()
    {
        var workspacePath = CreateWorkspace();
        var store = new AgentConversationArtifactStore();
        var artifactPath = ".agenthub/conversations/conversation-1/turns/0001-claude.md";
        Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(workspacePath, artifactPath))!);
        await File.WriteAllTextAsync(Path.Combine(workspacePath, artifactPath), "content");

        var validated = await store.ValidateTurnArtifactPathAsync(workspacePath, "conversation-1", artifactPath);

        Assert.Equal(artifactPath, validated.RelativePath);
        Assert.Equal(Path.GetFullPath(Path.Combine(workspacePath, artifactPath)), validated.AbsolutePath);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            store.ValidateTurnArtifactPathAsync(
                workspacePath,
                "conversation-1",
                ".agenthub/conversations/conversation-1/turns/../../outside.md"));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            store.ValidateTurnArtifactPathAsync(
                workspacePath,
                "conversation-1",
                Path.GetFullPath(Path.Combine(workspacePath, artifactPath))));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            store.ValidateTurnArtifactPathAsync(
                workspacePath,
                "conversation-1",
                ".agenthub/conversations/other/turns/0001-claude.md"));
        await Assert.ThrowsAsync<FileNotFoundException>(() =>
            store.ValidateTurnArtifactPathAsync(
                workspacePath,
                "conversation-1",
                ".agenthub/conversations/conversation-1/turns/0002-claude.md"));
    }

    [Fact]
    public async Task Writes_turn_artifact_with_trailing_newline()
    {
        var workspacePath = CreateWorkspace();
        var store = new AgentConversationArtifactStore();

        var written = await store.WriteTurnArtifactAsync(
            workspacePath,
            new WriteTurnArtifactInput("conversation-1", 1, "claude", "proposal"));

        Assert.Equal(".agenthub/conversations/conversation-1/turns/0001-claude.md", written.RelativePath);
        Assert.Equal("proposal\n", await File.ReadAllTextAsync(written.AbsolutePath));
    }

    [Theory]
    [InlineData("../evil")]
    [InlineData("nested/id")]
    [InlineData("C:/evil")]
    [InlineData(".")]
    [InlineData("..")]
    public async Task Rejects_unsafe_conversation_ids(string conversationId)
    {
        var workspacePath = CreateWorkspace();
        var store = new AgentConversationArtifactStore();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            store.InitializePairConversationAsync(
                workspacePath,
                new PairConversationArtifactInput(conversationId, "Unsafe", ["claude", "codex"], 6)));
        Assert.Throws<InvalidOperationException>(() => store.TurnArtifactPath(conversationId, 1, "claude"));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            store.ValidateTurnArtifactPathAsync(
                workspacePath,
                conversationId,
                ".agenthub/conversations/conversation-1/turns/0001-claude.md"));
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
