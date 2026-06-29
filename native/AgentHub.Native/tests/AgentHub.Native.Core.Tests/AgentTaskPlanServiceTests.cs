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

    [Fact]
    public async Task Records_sent_manager_routing_commands_to_execution_snapshot()
    {
        var workspacePath = CreateWorkspaceWithSourcePlan();
        var service = CreateService(out var store, out _, out _, out _);
        var plan = await service.CreatePlanAsync(workspacePath, new CreateAgentTaskPlanRequest(
            "Native Host",
            "20260629-native-host",
            "claude",
            ["codex", "gemini"]));
        var result = new AgentHubCommandDispatchResult(
            2,
            [
                new AgentHubSendMessageCommand(
                    "codex",
                    "Implement parser.",
                    null,
                    "T-001",
                    plan.Id,
                    null,
                    "codex-1",
                    "assign_task"),
                new AgentHubSendMessageCommand(
                    "gemini",
                    "Review parser.",
                    null,
                    "T-001",
                    plan.Id,
                    null,
                    "gemini-1",
                    "request_review")
            ],
            [],
            [],
            [],
            [],
            [],
            []);

        await service.RecordManagerDispatchResultAsync(workspacePath, "claude", result, "event-1");

        var history = await store.ListTaskHistoryAsync(workspacePath, plan.Id);
        Assert.Collection(
            history,
            item =>
            {
                Assert.Equal("T-001", item.Id);
                Assert.Equal("running", item.Status);
                Assert.Equal("codex", item.AssigneeProfileId);
                Assert.Equal(1, item.Attempt);
                Assert.Equal("Implement parser.", item.Description);
            },
            item =>
            {
                Assert.Equal("T-001", item.Id);
                Assert.Equal("review", item.Status);
                Assert.Equal("gemini", item.AssigneeProfileId);
                Assert.Equal(1, item.Attempt);
                Assert.Equal("Review parser.", item.Description);
            });
        var latest = Assert.Single(await store.ListTasksAsync(workspacePath, plan.Id));
        Assert.Equal("review", latest.Status);
        Assert.Equal("gemini", latest.AssigneeProfileId);
        var events = await store.ListEventsAsync(workspacePath, plan.Id);
        Assert.Contains(events, item =>
            item.Type == "assigned" &&
            item.TaskId == "T-001" &&
            item.FromProfileId == "claude" &&
            item.ToProfileId == "codex" &&
            item.SessionId == "codex-1" &&
            item.SourceEventId == "event-1");
        Assert.Contains(events, item =>
            item.Type == "review_requested" &&
            item.ToProfileId == "gemini" &&
            item.SessionId == "gemini-1");
    }

    [Fact]
    public async Task Records_plan_status_and_dispatch_failures_to_execution_snapshot()
    {
        var workspacePath = CreateWorkspaceWithSourcePlan();
        var service = CreateService(out var store, out _, out _, out _);
        var plan = await service.CreatePlanAsync(workspacePath, new CreateAgentTaskPlanRequest(
            "Native Host",
            "20260629-native-host",
            "claude",
            ["codex"]));
        var result = new AgentHubCommandDispatchResult(
            0,
            [],
            [
                new AgentHubPlanStatusCommand("approve_task", plan.Id, "T-001", "Accepted"),
                new AgentHubPlanStatusCommand("pause_plan", plan.Id, null, "Need user decision")
            ],
            [],
            [],
            [],
            [],
            [
                new AgentHubCommandDispatchError(
                    "codex",
                    "No active session for profile 'codex'",
                    new AgentHubSendMessageCommand(
                        "codex",
                        "Fix parser.",
                        null,
                        "T-002",
                        plan.Id,
                        null,
                        null,
                        "reject_task"))
            ]);

        await service.RecordManagerDispatchResultAsync(workspacePath, "claude", result, "event-2");

        var persisted = await store.GetPlanAsync(workspacePath, plan.Id);
        Assert.Equal("paused", persisted.Status);
        var done = Assert.Single(await store.ListTasksAsync(workspacePath, plan.Id), item => item.Id == "T-001");
        Assert.Equal("done", done.Status);
        Assert.Null(done.AssigneeProfileId);
        Assert.Equal("Accepted", done.Description);
        var events = await store.ListEventsAsync(workspacePath, plan.Id);
        Assert.Contains(events, item => item.Type == "approved" && item.TaskId == "T-001" && item.Message == "Accepted");
        Assert.Contains(events, item => item.Type == "paused" && item.Message == "Need user decision");
        Assert.Contains(events, item =>
            item.Type == "delivery_failed" &&
            item.TaskId == "T-002" &&
            item.ToProfileId == "codex" &&
            item.Message is not null &&
            item.Message.Contains("No active session for profile 'codex'", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Records_hook_completion_artifact_and_observes_manager()
    {
        var workspacePath = CreateWorkspaceWithSourcePlan();
        var service = CreateService(out var store, out _, out var inputRouter, out var registry);
        var plan = await service.CreatePlanAsync(workspacePath, new CreateAgentTaskPlanRequest(
            "Native Host",
            "20260629-native-host",
            "claude",
            ["codex"]));
        await service.RecordManagerDispatchResultAsync(
            workspacePath,
            "claude",
            new AgentHubCommandDispatchResult(
                1,
                [
                    new AgentHubSendMessageCommand(
                        "codex",
                        "Implement parser.",
                        null,
                        "T-001",
                        plan.Id,
                        null,
                        "codex-1",
                        "assign_task")
                ],
                [],
                [],
                [],
                [],
                [],
                []),
            "event-assign");
        var managerSession = new RecordingTerminalSession("claude-1");
        inputRouter.Register(managerSession);
        registry.Register(new AgentSessionDescriptor("claude-1", "claude", workspacePath, DateTimeOffset.UtcNow));

        await service.RecordHookCompletionAsync(
            workspacePath,
            new AgentTaskPlanHookCompletionInput(
                "codex",
                "Implementation done.",
                "codex-1",
                "run-2",
                null,
                null,
                "event-complete"));

        var latest = Assert.Single(await store.ListTasksAsync(workspacePath, plan.Id));
        Assert.Equal("review", latest.Status);
        Assert.Equal("codex", latest.AssigneeProfileId);
        Assert.Equal("run-2", latest.RunId);
        Assert.Equal("Implementation done.", latest.Description);
        Assert.Equal("artifacts/T-001-codex-run-2.md", latest.ArtifactPath);
        Assert.NotNull(latest.ArtifactPath);
        Assert.Equal("Implementation done.", await File.ReadAllTextAsync(Path.Combine(plan.PlanPath, latest.ArtifactPath!)));
        var events = await store.ListEventsAsync(workspacePath, plan.Id);
        Assert.Contains(events, item =>
            item.Type == "hook_completed" &&
            item.TaskId == "T-001" &&
            item.FromProfileId == "codex" &&
            item.ToProfileId == "claude" &&
            item.ArtifactPath == "artifacts/T-001-codex-run-2.md" &&
            item.SourceEventId == "event-complete");
        Assert.Equal("\x1b[200~", managerSession.Writes[0]);
        Assert.Contains("AgentHub delegated task completed observation.", managerSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains($"Plan ID: {plan.Id}", managerSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Task: T-001", managerSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Artifact: artifacts/T-001-codex-run-2.md", managerSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("\"action\":\"approve_task\"", managerSession.Writes[1], StringComparison.Ordinal);
        Assert.Equal("\x1b[201~", managerSession.Writes[2]);
        Assert.Equal("\r", managerSession.Writes[3]);
    }

    [Fact]
    public async Task Records_hook_completion_delivery_failure_when_manager_session_is_missing()
    {
        var workspacePath = CreateWorkspaceWithSourcePlan();
        var service = CreateService(out var store, out _, out _, out _);
        var plan = await service.CreatePlanAsync(workspacePath, new CreateAgentTaskPlanRequest(
            "Native Host",
            "20260629-native-host",
            "claude",
            ["codex"]));
        await service.RecordManagerDispatchResultAsync(
            workspacePath,
            "claude",
            new AgentHubCommandDispatchResult(
                1,
                [
                    new AgentHubSendMessageCommand(
                        "codex",
                        "Implement parser.",
                        null,
                        "T-001",
                        plan.Id,
                        null,
                        "codex-1",
                        "assign_task")
                ],
                [],
                [],
                [],
                [],
                [],
                []));

        await service.RecordHookCompletionAsync(
            workspacePath,
            new AgentTaskPlanHookCompletionInput("codex", "Implementation done.", "codex-1", "run-2"));

        var events = await store.ListEventsAsync(workspacePath, plan.Id);
        Assert.Contains(events, item =>
            item.Type == "delivery_failed" &&
            item.TaskId == "T-001" &&
            item.FromProfileId == "codex" &&
            item.ToProfileId == "claude" &&
            item.ArtifactPath == "artifacts/T-001-codex-run-2.md" &&
            item.Message is not null &&
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
