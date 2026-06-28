using AgentHub.Native.Core.Workspaces;

namespace AgentHub.Native.Core.Tests;

public sealed class WorkspaceStoreTests : IDisposable
{
    private readonly string tempRoot = Path.Combine(Path.GetTempPath(), "agenthub-native-workspaces", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Adds_workspace_once_and_persists_it()
    {
        var storePath = Path.Combine(tempRoot, "workspaces.json");
        var store = new WorkspaceStore(storePath);

        await store.AddOrUpdateAsync(@"V:\OrderManager");
        await store.AddOrUpdateAsync(@"v:\OrderManager\");

        var reloaded = new WorkspaceStore(storePath);
        var workspaces = await reloaded.LoadAsync();

        var workspace = Assert.Single(workspaces);
        Assert.Equal(@"V:\OrderManager", workspace.Path);
        Assert.Equal("OrderManager", workspace.Name);
    }

    [Fact]
    public async Task Removes_workspace_by_path()
    {
        var storePath = Path.Combine(tempRoot, "workspaces.json");
        var store = new WorkspaceStore(storePath);
        await store.AddOrUpdateAsync(@"V:\OrderManager");
        await store.AddOrUpdateAsync(@"D:\GoldAgent");

        await store.RemoveAsync(@"v:\OrderManager\");

        var workspaces = await store.LoadAsync();
        var workspace = Assert.Single(workspaces);
        Assert.Equal(@"D:\GoldAgent", workspace.Path);
    }

    public void Dispose()
    {
        if (Directory.Exists(tempRoot))
        {
            Directory.Delete(tempRoot, recursive: true);
        }
    }
}
