using AgentHub.Native.Core.Collaboration;
using AgentHub.Native.Core.Input;
using AgentHub.Native.Core.TaskPlans;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentTaskPlanServiceTests : IDisposable
{
    private readonly string tempRoot = Path.Combine(
        Path.GetTempPath(),
        "agenthub-native-task-plan-service",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Create_plan_records_created_event()
    {
        var workspacePath = CreateWorkspaceWithSourcePlan();
        var service = CreateService(out var store, out _, out _, out _);

        var plan = await service.CreatePlanAsync(workspacePath, new CreateAgentTaskPlanRequest(
            "Native Host",
            "20260629-native-host",
            "claude",
            ["codex", "gemini"]));

        var item = Assert.Single(await store.ListEventsAsync(workspacePath, plan.Id));
        Assert.Equal("created", item.Type);
        Assert.Equal(plan.Title, item.Message);
        Assert.Equal("claude", item.ToProfileId);
    }

    [Fact]
    public async Task Start_manager_sends_prompt_to_latest_manager_session_and_marks_plan_running()
    {
        var workspacePath = CreateWorkspaceWithSourcePlan();
        var service = CreateService(out var store, out var timelineStore, out var inputRouter, out var registry);
        var plan = await service.CreatePlanAsync(workspacePath, new CreateAgentTaskPlanRequest(
            "Native Host",
            "20260629-native-host",
            "claude",
            ["codex", "gemini"]));
        var olderSession = new RecordingTerminalSession("claude-old");
        var latestSession = new RecordingTerminalSession("claude-latest");
        inputRouter.Register(olderSession);
        inputRouter.Register(latestSession);
        registry.Register(new AgentSessionDescriptor("claude-old", "claude", workspacePath, DateTimeOffset.Parse("2026-06-29T10:00:00Z")));
        registry.Register(new AgentSessionDescriptor("claude-latest", "claude", workspacePath, DateTimeOffset.Parse("2026-06-29T10:01:00Z")));

        var updated = await service.StartManagerAsync(workspacePath, plan.Id);

        Assert.Equal("running", updated.Status);
        Assert.Empty(olderSession.Writes);
        Assert.Equal("\x1b[200~", latestSession.Writes[0]);
        Assert.Contains("AgentHub task-plan manager.", latestSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains($"Plan ID: {plan.Id}", latestSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains(plan.SourcePlanPath, latestSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Available agents: codex, gemini", latestSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("\"action\":\"assign_task\"", latestSession.Writes[1], StringComparison.Ordinal);
        Assert.Equal("\x1b[201~", latestSession.Writes[2]);
        Assert.Equal("\r", latestSession.Writes[3]);

        var persisted = await store.GetPlanAsync(workspacePath, plan.Id);
        Assert.Equal("running", persisted.Status);
        var events = await store.ListEventsAsync(workspacePath, plan.Id);
        Assert.Contains(events, item => item.Type == "manager_started" && item.SessionId == "claude-latest");
        var timeline = await timelineStore.ListAsync(workspacePath);
        Assert.Contains(timeline, item =>
            item.Kind == CollaborationEventKind.UserMessage &&
            item.ProfileId == "agenthub" &&
            item.TargetProfileId == "claude" &&
            item.Message.Contains("Task plan manager started", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Start_manager_records_delivery_failed_when_manager_session_is_missing()
    {
        var workspacePath = CreateWorkspaceWithSourcePlan();
        var service = CreateService(out var store, out var timelineStore, out _, out _);
        var plan = await service.CreatePlanAsync(workspacePath, new CreateAgentTaskPlanRequest(
            "Native Host",
            "20260629-native-host",
            "claude",
            ["codex"]));

        var unchanged = await service.StartManagerAsync(workspacePath, plan.Id);

        Assert.Equal("draft", unchanged.Status);
        var item = Assert.Single(await store.ListEventsAsync(workspacePath, plan.Id), item => item.Type == "delivery_failed");
        Assert.Equal("claude", item.ToProfileId);
        Assert.Contains("No active session for profile 'claude'", item.Message, StringComparison.Ordinal);
        var timeline = await timelineStore.ListAsync(workspacePath);
        Assert.Contains(timeline, item =>
            item.Kind == CollaborationEventKind.AgentHubCommandError &&
            item.Message.Contains("No active session for profile 'claude'", StringComparison.Ordinal));
    }

    public void Dispose()
    {
        if (Directory.Exists(tempRoot))
        {
            Directory.Delete(tempRoot, recursive: true);
        }
    }

    private AgentTaskPlanService CreateService(
        out AgentTaskPlanStore store,
        out CollaborationEventStore timelineStore,
        out AgentInputRouter inputRouter,
        out AgentSessionRegistry registry)
    {
        store = new AgentTaskPlanStore(new AgentTaskPlanStoreOptions
        {
            UtcNow = () => DateTimeOffset.Parse("2026-06-29T12:34:56Z")
        });
        timelineStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        inputRouter = new AgentInputRouter();
        registry = new AgentSessionRegistry();
        return new AgentTaskPlanService(store, timelineStore, inputRouter, registry);
    }

    private string CreateWorkspaceWithSourcePlan()
    {
        var workspacePath = Path.Combine(tempRoot, "workspace-" + Guid.NewGuid().ToString("N"));
        var taskDir = Path.Combine(workspacePath, "tasks", "20260629-native-host");
        Directory.CreateDirectory(taskDir);
        File.WriteAllText(Path.Combine(taskDir, "task-plan.md"), "# Native Host\n\n- [ ] Build manager startup");
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
