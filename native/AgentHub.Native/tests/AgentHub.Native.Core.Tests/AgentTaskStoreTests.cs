using AgentHub.Native.Core.Collaboration;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentTaskStoreTests : IDisposable
{
    private readonly string workspacePath = Path.Combine(Path.GetTempPath(), "agenthub-native-task-store", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Creates_and_updates_tasks_in_jsonl_task_log()
    {
        var store = new AgentTaskStore();

        var task = await store.CreateAsync(workspacePath, new AgentTaskCreateRequest(
            "Implement backend",
            "Add stores",
            "pending",
            "codex",
            null));
        var updated = await store.UpdateAsync(workspacePath, task.Id, new AgentTaskUpdateRequest(
            Status: "running",
            ProfileId: "codex",
            RunId: "run-1"));

        var tasks = await store.ListAsync(workspacePath);
        var rawTasks = await File.ReadAllTextAsync(Path.Combine(workspacePath, ".agenthub", "tasks", "tasks.jsonl"));

        Assert.Equal(task.Id, updated.Id);
        Assert.Equal("running", updated.Status);
        Assert.Equal("run-1", updated.RunId);
        var listed = Assert.Single(tasks);
        Assert.Equal(task.Id, listed.Id);
        Assert.Equal("Implement backend", listed.Title);
        Assert.Equal("running", listed.Status);
        Assert.Contains("\"profileId\":\"codex\"", rawTasks);
    }

    [Fact]
    public async Task Throws_when_updating_unknown_task()
    {
        var store = new AgentTaskStore();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            store.UpdateAsync(workspacePath, "missing-task", new AgentTaskUpdateRequest(Status: "running")));

        Assert.Equal("Unknown task: missing-task", ex.Message);
    }

    public void Dispose()
    {
        if (Directory.Exists(workspacePath))
        {
            Directory.Delete(workspacePath, recursive: true);
        }
    }
}
