using AgentHub.Native.Core.TaskPlans;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentTaskPlanStoreTests : IDisposable
{
    private readonly string workspacePath = Path.Combine(
        Path.GetTempPath(),
        "agenthub-native-task-plan-store",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Lists_task_plan_sources_from_workspace_tasks_directory()
    {
        Directory.CreateDirectory(Path.Combine(workspacePath, "tasks", "20260629-1100-good"));
        await File.WriteAllTextAsync(
            Path.Combine(workspacePath, "tasks", "20260629-1100-good", "task-plan.md"),
            "# Build native host\n\n- [ ] Add store");
        Directory.CreateDirectory(Path.Combine(workspacePath, "tasks", "20260629-1200-no-title"));
        await File.WriteAllTextAsync(
            Path.Combine(workspacePath, "tasks", "20260629-1200-no-title", "task-plan.md"),
            "No heading here");
        Directory.CreateDirectory(Path.Combine(workspacePath, "tasks", "20260629-1300-missing"));
        Directory.CreateDirectory(Path.Combine(workspacePath, "tasks", "20260629-1400-empty"));
        await File.WriteAllTextAsync(
            Path.Combine(workspacePath, "tasks", "20260629-1400-empty", "task-plan.md"),
            "   ");
        var store = new AgentTaskPlanStore();

        var sources = await store.ListSourceTasksAsync(workspacePath);

        Assert.Collection(
            sources,
            source =>
            {
                Assert.Equal("20260629-1100-good", source.DirectoryName);
                Assert.Equal("Build native host", source.Title);
                Assert.Equal(Path.Combine(workspacePath, "tasks", "20260629-1100-good"), source.TaskDir);
                Assert.Equal(Path.Combine(source.TaskDir, "task-plan.md"), source.SourcePlanPath);
            },
            source =>
            {
                Assert.Equal("20260629-1200-no-title", source.DirectoryName);
                Assert.Equal("20260629-1200-no-title", source.Title);
            });
    }

    [Fact]
    public async Task Creates_dated_task_plan_snapshot_from_selected_source()
    {
        var taskDir = Path.Combine(workspacePath, "tasks", "20260629-1100-native-host");
        Directory.CreateDirectory(taskDir);
        await File.WriteAllTextAsync(Path.Combine(taskDir, "task-plan.md"), "# Native Host\n\n- [ ] Run Codex");
        var store = new AgentTaskPlanStore(new AgentTaskPlanStoreOptions
        {
            UtcNow = () => DateTimeOffset.Parse("2026-06-29T12:34:56Z")
        });

        var plan = await store.CreatePlanAsync(workspacePath, new CreateAgentTaskPlanRequest(
            "Native Host",
            "20260629-1100-native-host",
            "claude",
            ["codex", "gemini"]));

        Assert.Equal("20260629-123456-native-host", plan.Id);
        Assert.Equal("Native Host", plan.Title);
        Assert.Equal("draft", plan.Status);
        Assert.Equal("claude", plan.ManagerProfileId);
        Assert.Equal(["codex", "gemini"], plan.ParticipantProfileIds);
        Assert.Equal("2026-06-29", plan.Date);
        Assert.Equal("123456-native-host", plan.DirectoryName);
        Assert.Equal(taskDir, plan.SourceTaskDir);
        Assert.Equal(Path.Combine(taskDir, "task-plan.md"), plan.SourcePlanPath);
        Assert.Equal("2026-06-29T12:34:56.0000000+00:00", plan.CreatedAt.ToString("O"));

        await AssertFileEqualsAsync(Path.Combine(plan.PlanPath, "task-plan.md"), "# Native Host\n\n- [ ] Run Codex");
        Assert.True(Directory.Exists(Path.Combine(plan.PlanPath, "artifacts")));
        await AssertFileEqualsAsync(Path.Combine(plan.PlanPath, "tasks.jsonl"), string.Empty);
        await AssertFileEqualsAsync(Path.Combine(plan.PlanPath, "events.jsonl"), string.Empty);

        var listed = Assert.Single(await store.ListPlansAsync(workspacePath));
        Assert.Equal(plan.Id, listed.Id);
        Assert.Equal(plan.PlanPath, listed.PlanPath);
        Assert.Equal("# Native Host\n\n- [ ] Run Codex", await store.ReadMarkdownAsync(workspacePath, plan.Id));
    }

    [Fact]
    public async Task Rejects_invalid_or_empty_task_plan_sources()
    {
        var taskDir = Path.Combine(workspacePath, "tasks", "20260629-1100-empty");
        Directory.CreateDirectory(taskDir);
        await File.WriteAllTextAsync(Path.Combine(taskDir, "task-plan.md"), "");
        var store = new AgentTaskPlanStore();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            store.CreatePlanAsync(workspacePath, new CreateAgentTaskPlanRequest(
                "Empty",
                "20260629-1100-empty",
                "claude",
                ["codex"])));
        await Assert.ThrowsAsync<ArgumentException>(() =>
            store.CreatePlanAsync(workspacePath, new CreateAgentTaskPlanRequest(
                "Unsafe",
                "../escape",
                "claude",
                ["codex"])));
    }

    public void Dispose()
    {
        if (Directory.Exists(workspacePath))
        {
            Directory.Delete(workspacePath, recursive: true);
        }
    }

    private static async Task AssertFileEqualsAsync(string path, string expected)
    {
        Assert.Equal(expected, await File.ReadAllTextAsync(path));
    }
}
