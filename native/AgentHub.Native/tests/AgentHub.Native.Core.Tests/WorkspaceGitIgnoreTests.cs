using AgentHub.Native.Core.Workspaces;

namespace AgentHub.Native.Core.Tests;

public sealed class WorkspaceGitIgnoreTests : IDisposable
{
    private readonly string tempRoot = Path.Combine(Path.GetTempPath(), "agenthub-native-gitignore", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Creates_root_gitignore_with_agenthub_runtime_directories()
    {
        var workspace = Path.Combine(tempRoot, "workspace");
        Directory.CreateDirectory(workspace);

        var changed = await WorkspaceGitIgnore.EnsureAsync(workspace);

        Assert.True(changed);
        Assert.Equal(
            ".agenthub/\n.codex/\n.claude/\n.gemini/\n",
            await File.ReadAllTextAsync(Path.Combine(workspace, ".gitignore")));
    }

    [Fact]
    public void Does_not_rewrite_when_equivalent_entries_already_exist()
    {
        const string raw = ".agenthub\n/.codex/\n.claude/**\n.gemini/*\n";

        Assert.Equal(raw, WorkspaceGitIgnore.Merge(raw));
    }

    [Fact]
    public void Adds_only_missing_entries()
    {
        Assert.Equal(
            ".agenthub/\n.codex/\n.claude/\n.gemini/\n",
            WorkspaceGitIgnore.Merge(".agenthub/\n.codex/\n"));
    }

    public void Dispose()
    {
        if (Directory.Exists(tempRoot))
        {
            Directory.Delete(tempRoot, recursive: true);
        }
    }
}
