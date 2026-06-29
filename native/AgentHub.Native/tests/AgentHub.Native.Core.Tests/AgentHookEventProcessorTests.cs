using AgentHub.Native.Core.Collaboration;
using AgentHub.Native.Core.Hooks;
using AgentHub.Native.Core.Input;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentHookEventProcessorTests : IDisposable
{
    private readonly string tempRoot = Path.Combine(Path.GetTempPath(), "agenthub-native-hook-processor", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Records_agent_output_dispatches_commands_and_records_forwarded_messages()
    {
        var workspacePath = CreateWorkspace();
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var teamStore = new AgentTeamStore();
        var target = new RecordingTerminalSession("codex-1");
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(target);
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", workspacePath, DateTimeOffset.UtcNow));
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(inputRouter, registry));
        var processor = new AgentHookEventProcessor(store, dispatcher, teamStore);

        var result = await processor.ProcessAsync(new AgentHookEvent(
            workspacePath,
            "Done.\n<agenthub>{\"action\":\"send_message\",\"to\":\"codex\",\"message\":\"Please inspect.\",\"team_id\":\"default\",\"task_id\":\"T-001\",\"conversation_id\":\"C-001\"}</agenthub>",
            "claude",
            "claude-1",
            "run-1",
            "claude"));

        Assert.Equal(1, result.SentCount);
        Assert.Equal(["Please inspect.", "\r"], target.Writes);
        var events = await store.ListAsync(workspacePath);
        Assert.Equal([CollaborationEventKind.AgentOutput, CollaborationEventKind.UserMessage], events.Select(item => item.Kind).ToArray());
        Assert.Equal("claude", events[0].ProfileId);
        Assert.Equal("agenthub", events[1].ProfileId);
        Assert.Equal("codex", events[1].TargetProfileId);
        Assert.Equal("Please inspect.", events[1].Message);
        var mailbox = await teamStore.ListMailboxAsync(workspacePath, "default");
        var mailboxMessage = Assert.Single(mailbox);
        Assert.Equal("send_message", mailboxMessage.Action);
        Assert.Equal("claude", mailboxMessage.FromProfileId);
        Assert.Equal("codex", mailboxMessage.ToProfileId);
        Assert.Equal("sent", mailboxMessage.Status);
        Assert.Equal("codex-1", mailboxMessage.SessionId);
        Assert.Equal("T-001", mailboxMessage.TaskId);
        Assert.Equal("C-001", mailboxMessage.ConversationId);
    }

    [Fact]
    public async Task Records_dispatch_errors_from_agenthub_commands()
    {
        var workspacePath = CreateWorkspace();
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var teamStore = new AgentTeamStore();
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(new AgentInputRouter(), new AgentSessionRegistry()));
        var processor = new AgentHookEventProcessor(store, dispatcher, teamStore);

        var result = await processor.ProcessAsync(new AgentHookEvent(
            workspacePath,
            "<agenthub>{\"action\":\"send_message\",\"to\":\"codex\",\"message\":\"Please inspect.\",\"team_id\":\"default\",\"task_id\":\"T-001\"}</agenthub>",
            "claude",
            "claude-1",
            "run-1",
            "claude"));

        Assert.Equal(0, result.SentCount);
        var dispatchError = Assert.Single(result.DispatchErrors);
        Assert.Equal("codex", dispatchError.TargetProfileId);
        var events = await store.ListAsync(workspacePath);
        Assert.Equal([CollaborationEventKind.AgentOutput, CollaborationEventKind.AgentHubCommandError], events.Select(item => item.Kind).ToArray());
        Assert.Equal("agenthub", events[1].ProfileId);
        Assert.Equal("command-error", events[1].TargetProfileId);
        Assert.Contains("No active session for profile 'codex'", events[1].Message, StringComparison.Ordinal);
        var mailbox = await teamStore.ListMailboxAsync(workspacePath, "default");
        var mailboxMessage = Assert.Single(mailbox);
        Assert.Equal("send_message", mailboxMessage.Action);
        Assert.Equal("failed", mailboxMessage.Status);
        Assert.Equal("codex", mailboxMessage.ToProfileId);
        Assert.Contains("No active session for profile 'codex'", mailboxMessage.Error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Records_task_plan_routing_plan_id_to_mailbox()
    {
        var workspacePath = CreateWorkspace();
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var teamStore = new AgentTeamStore();
        var target = new RecordingTerminalSession("codex-1");
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(target);
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", workspacePath, DateTimeOffset.UtcNow));
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(inputRouter, registry));
        var processor = new AgentHookEventProcessor(store, dispatcher, teamStore);

        await processor.ProcessAsync(new AgentHookEvent(
            workspacePath,
            "<agenthub>{\"action\":\"assign_task\",\"plan_id\":\"P-001\",\"task_id\":\"T-001\",\"to\":\"codex\",\"message\":\"Implement task A.\"}</agenthub>",
            "claude",
            "claude-1",
            "run-1",
            "claude"));

        var mailbox = await teamStore.ListMailboxAsync(workspacePath, "default");
        var mailboxMessage = Assert.Single(mailbox);
        Assert.Equal("send_message", mailboxMessage.Action);
        Assert.Equal("T-001", mailboxMessage.TaskId);
        Assert.Equal("P-001", mailboxMessage.PlanId);
    }

    [Fact]
    public async Task Records_task_plan_status_commands_to_task_plan_events()
    {
        var workspacePath = CreateWorkspace();
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var taskPlanEventStore = new AgentTaskPlanEventStore();
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(new AgentInputRouter(), new AgentSessionRegistry()));
        var processor = new AgentHookEventProcessor(
            store,
            dispatcher,
            taskPlanEventStore: taskPlanEventStore);

        await processor.ProcessAsync(new AgentHookEvent(
            workspacePath,
            "<agenthub>{\"action\":\"approve_task\",\"plan_id\":\"P-001\",\"task_id\":\"T-001\",\"summary\":\"Accepted\"}</agenthub>\n" +
            "<agenthub>{\"action\":\"pause_plan\",\"plan_id\":\"P-001\",\"reason\":\"Need user decision\"}</agenthub>",
            "claude",
            "claude-1",
            "run-1",
            "claude"));

        var events = await taskPlanEventStore.ListEventsAsync(workspacePath, "P-001");
        Assert.Collection(
            events,
            item =>
            {
                Assert.Equal("approved", item.Type);
                Assert.Equal("P-001", item.PlanId);
                Assert.Equal("T-001", item.TaskId);
                Assert.Equal("claude", item.FromProfileId);
                Assert.Equal("Accepted", item.Message);
                Assert.Equal("claude-1", item.SessionId);
                Assert.Equal("run-1", item.RunId);
            },
            item =>
            {
                Assert.Equal("paused", item.Type);
                Assert.Equal("P-001", item.PlanId);
                Assert.Null(item.TaskId);
                Assert.Equal("Need user decision", item.Message);
            });
    }

    [Fact]
    public async Task Records_task_plan_routing_commands_to_task_plan_events()
    {
        var workspacePath = CreateWorkspace();
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var taskPlanEventStore = new AgentTaskPlanEventStore();
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(new RecordingTerminalSession("codex-1"));
        inputRouter.Register(new RecordingTerminalSession("gemini-1"));
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", workspacePath, DateTimeOffset.UtcNow));
        registry.Register(new AgentSessionDescriptor("gemini-1", "gemini", workspacePath, DateTimeOffset.UtcNow));
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(inputRouter, registry));
        var processor = new AgentHookEventProcessor(
            store,
            dispatcher,
            taskPlanEventStore: taskPlanEventStore);

        await processor.ProcessAsync(new AgentHookEvent(
            workspacePath,
            "<agenthub>{\"action\":\"assign_task\",\"plan_id\":\"P-001\",\"task_id\":\"T-001\",\"to\":\"codex\",\"message\":\"Implement task.\"}</agenthub>\n" +
            "<agenthub>{\"action\":\"request_review\",\"plan_id\":\"P-001\",\"task_id\":\"T-001\",\"to\":\"gemini\",\"message\":\"Review task.\"}</agenthub>\n" +
            "<agenthub>{\"action\":\"reject_task\",\"plan_id\":\"P-001\",\"task_id\":\"T-001\",\"to\":\"codex\",\"message\":\"Fix task.\"}</agenthub>",
            "claude",
            "claude-1",
            "run-1",
            "claude"));

        var events = await taskPlanEventStore.ListEventsAsync(workspacePath, "P-001");
        Assert.Collection(
            events,
            item =>
            {
                Assert.Equal("assigned", item.Type);
                Assert.Equal("T-001", item.TaskId);
                Assert.Equal("claude", item.FromProfileId);
                Assert.Equal("codex", item.ToProfileId);
                Assert.Equal("Implement task.", item.Message);
                Assert.Equal("codex-1", item.SessionId);
            },
            item =>
            {
                Assert.Equal("review_requested", item.Type);
                Assert.Equal("gemini", item.ToProfileId);
                Assert.Equal("Review task.", item.Message);
                Assert.Equal("gemini-1", item.SessionId);
            },
            item =>
            {
                Assert.Equal("rejected", item.Type);
                Assert.Equal("codex", item.ToProfileId);
                Assert.Equal("Fix task.", item.Message);
                Assert.Equal("codex-1", item.SessionId);
            });
    }

    [Fact]
    public async Task Records_failed_task_plan_routing_commands_to_task_plan_events()
    {
        var workspacePath = CreateWorkspace();
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var taskPlanEventStore = new AgentTaskPlanEventStore();
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(new AgentInputRouter(), new AgentSessionRegistry()));
        var processor = new AgentHookEventProcessor(
            store,
            dispatcher,
            taskPlanEventStore: taskPlanEventStore);

        await processor.ProcessAsync(new AgentHookEvent(
            workspacePath,
            "<agenthub>{\"action\":\"assign_task\",\"plan_id\":\"P-001\",\"task_id\":\"T-002\",\"to\":\"codex\",\"message\":\"Implement task.\"}</agenthub>",
            "claude",
            "claude-1",
            "run-1",
            "claude"));

        var item = Assert.Single(await taskPlanEventStore.ListEventsAsync(workspacePath, "P-001"));
        Assert.Equal("delivery_failed", item.Type);
        Assert.Equal("T-002", item.TaskId);
        Assert.Equal("claude", item.FromProfileId);
        Assert.Equal("codex", item.ToProfileId);
        Assert.Contains("No active session for profile 'codex'", item.Message, StringComparison.Ordinal);
        Assert.Equal("claude-1", item.SessionId);
        Assert.Equal("run-1", item.RunId);
    }

    [Fact]
    public async Task Records_team_status_commands_to_mailbox()
    {
        var workspacePath = CreateWorkspace();
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var teamStore = new AgentTeamStore();
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(new AgentInputRouter(), new AgentSessionRegistry()));
        var processor = new AgentHookEventProcessor(store, dispatcher, teamStore);

        await processor.ProcessAsync(new AgentHookEvent(
            workspacePath,
            "<agenthub>{\"action\":\"claim_task\",\"task_id\":\"T-001\",\"team_id\":\"default\"}</agenthub>\n" +
            "<agenthub>{\"action\":\"complete_task\",\"task_id\":\"T-001\",\"summary\":\"Done with tests.\",\"team_id\":\"default\"}</agenthub>",
            "codex",
            "codex-1",
            "run-1",
            "codex"));

        var mailbox = await teamStore.ListMailboxAsync(workspacePath, "default");
        Assert.Collection(
            mailbox,
            item =>
            {
                Assert.Equal("claim_task", item.Action);
                Assert.Equal("codex", item.FromProfileId);
                Assert.Equal("T-001", item.TaskId);
                Assert.Equal("observed", item.Status);
            },
            item =>
            {
                Assert.Equal("complete_task", item.Action);
                Assert.Equal("codex", item.FromProfileId);
                Assert.Equal("Done with tests.", item.Message);
                Assert.Equal("observed", item.Status);
            });
    }

    [Fact]
    public async Task Records_direct_pair_negotiation_handoffs_to_mailbox()
    {
        var workspacePath = CreateWorkspace();
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var teamStore = new AgentTeamStore();
        var target = new RecordingTerminalSession("codex-1");
        var inputRouter = new AgentInputRouter();
        inputRouter.Register(target);
        var registry = new AgentSessionRegistry();
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", workspacePath, DateTimeOffset.UtcNow));
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(inputRouter, registry));
        var processor = new AgentHookEventProcessor(store, dispatcher, teamStore);

        await processor.ProcessAsync(new AgentHookEvent(
            workspacePath,
            "<agenthub>{\"action\":\"continue\",\"proposal_version\":2,\"message\":\"Please review version 2.\",\"message_to\":\"codex\",\"summary\":\"Version 2 adds tests.\"}</agenthub>",
            "claude",
            "claude-1",
            "run-1",
            "claude"));

        Assert.Equal(["Please review version 2.", "\r"], target.Writes);
        var mailbox = await teamStore.ListMailboxAsync(workspacePath, "default");
        var mailboxMessage = Assert.Single(mailbox);
        Assert.Equal("continue", mailboxMessage.Action);
        Assert.Equal("claude", mailboxMessage.FromProfileId);
        Assert.Equal("codex", mailboxMessage.ToProfileId);
        Assert.Equal("Please review version 2.", mailboxMessage.Message);
        Assert.Equal("sent", mailboxMessage.Status);
        Assert.Equal("codex-1", mailboxMessage.SessionId);
    }

    [Fact]
    public async Task Updates_task_log_from_team_status_commands()
    {
        var workspacePath = CreateWorkspace();
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var teamStore = new AgentTeamStore();
        var taskStore = new AgentTaskStore();
        var task = await taskStore.CreateAsync(workspacePath, new AgentTaskCreateRequest(
            "Implement feature",
            "Add mailbox",
            "pending",
            null,
            null));
        var dispatcher = new AgentHubCommandDispatcher(new AgentMessageRouter(new AgentInputRouter(), new AgentSessionRegistry()));
        var processor = new AgentHookEventProcessor(store, dispatcher, teamStore, taskStore);

        await processor.ProcessAsync(new AgentHookEvent(
            workspacePath,
            $"<agenthub>{{\"action\":\"claim_task\",\"task_id\":\"{task.Id}\",\"team_id\":\"default\"}}</agenthub>\n" +
            $"<agenthub>{{\"action\":\"complete_task\",\"task_id\":\"{task.Id}\",\"summary\":\"Done with tests.\",\"team_id\":\"default\"}}</agenthub>",
            "codex",
            "codex-1",
            "run-1",
            "codex"));

        var tasks = await taskStore.ListAsync(workspacePath);
        var updated = Assert.Single(tasks);
        Assert.Equal(task.Id, updated.Id);
        Assert.Equal("done", updated.Status);
        Assert.Equal("codex", updated.ProfileId);
        Assert.Equal("run-1", updated.RunId);
    }

    public void Dispose()
    {
        if (Directory.Exists(tempRoot))
        {
            Directory.Delete(tempRoot, recursive: true);
        }
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

    private string CreateWorkspace()
    {
        var workspacePath = Path.Combine(tempRoot, "workspace-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workspacePath);
        return workspacePath;
    }
}
