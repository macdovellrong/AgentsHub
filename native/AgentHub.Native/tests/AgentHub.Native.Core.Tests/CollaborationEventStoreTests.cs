using AgentHub.Native.Core.Collaboration;
using AgentHub.Native.Core.Hooks;

namespace AgentHub.Native.Core.Tests;

public sealed class CollaborationEventStoreTests : IDisposable
{
    private readonly string tempRoot = Path.Combine(Path.GetTempPath(), "agenthub-native-events", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Appends_and_lists_workspace_events_in_order()
    {
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));

        var sent = await store.AppendUserMessageAsync(new CollaborationUserMessage(
            @"V:\OrderManager",
            "user",
            "codex",
            "please inspect"));
        var output = await store.AppendAgentOutputAsync(new AgentHookEvent(
            @"V:\OrderManager",
            "done",
            "codex",
            "codex-1",
            "run-1",
            "codex"));

        var events = await store.ListAsync(@"v:\OrderManager\");

        Assert.Equal([sent.Id, output.Id], events.Select(item => item.Id).ToArray());
        Assert.Equal(CollaborationEventKind.UserMessage, events[0].Kind);
        Assert.Equal("codex", events[0].TargetProfileId);
        Assert.Equal("please inspect", events[0].Message);
        Assert.Equal(CollaborationEventKind.AgentOutput, events[1].Kind);
        Assert.Equal("codex", events[1].ProfileId);
        Assert.Equal("done", events[1].Message);
    }

    [Fact]
    public async Task List_skips_invalid_jsonl_lines()
    {
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var sent = await store.AppendUserMessageAsync(new CollaborationUserMessage(
            @"V:\OrderManager",
            "user",
            "codex",
            "please inspect"));
        var eventsDirectory = Path.Combine(tempRoot, "events");
        var eventFile = Assert.Single(Directory.GetFiles(eventsDirectory, "*.jsonl"));
        await File.AppendAllTextAsync(eventFile, "{ broken json\n\n");

        var events = await store.ListAsync(@"V:\OrderManager");

        Assert.Equal([sent.Id], events.Select(item => item.Id).ToArray());
    }

    [Fact]
    public async Task Appends_forwarded_agenthub_commands_as_agenthub_user_messages()
    {
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var result = new AgentHubCommandDispatchResult(
            1,
            [new AgentHubSendMessageCommand("codex", "Please inspect.", null, null, null, null)],
            [],
            [],
            [],
            [],
            [],
            []);

        await store.AppendForwardedAgentHubCommandsAsync(@"V:\OrderManager", result);

        var item = Assert.Single(await store.ListAsync(@"V:\OrderManager"));
        Assert.Equal(CollaborationEventKind.UserMessage, item.Kind);
        Assert.Equal("agenthub", item.ProfileId);
        Assert.Equal("codex", item.TargetProfileId);
        Assert.Equal("Please inspect.", item.Message);
    }

    [Fact]
    public async Task Appends_task_plan_status_commands_as_agenthub_timeline_messages()
    {
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var result = new AgentHubCommandDispatchResult(
            0,
            [],
            [
                new AgentHubPlanStatusCommand("approve_task", "P001", "T001", "Looks good"),
                new AgentHubPlanStatusCommand("pause_plan", "P001", null, "Need user decision")
            ],
            [],
            [],
            [],
            [],
            []);

        await store.AppendForwardedAgentHubCommandsAsync(@"V:\OrderManager", result);

        var events = await store.ListAsync(@"V:\OrderManager");
        Assert.Equal(2, events.Count);
        Assert.All(events, item =>
        {
            Assert.Equal(CollaborationEventKind.UserMessage, item.Kind);
            Assert.Equal("agenthub", item.ProfileId);
            Assert.Equal("task-plan", item.TargetProfileId);
        });
        Assert.Equal("[approve_task P001/T001] Looks good", events[0].Message);
        Assert.Equal("[pause_plan P001] Need user decision", events[1].Message);
    }

    [Fact]
    public async Task Appends_team_status_commands_as_agenthub_timeline_messages()
    {
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var result = new AgentHubCommandDispatchResult(
            0,
            [],
            [],
            [
                new AgentHubTeamStatusCommand("claim_task", "default", "T-001", null),
                new AgentHubTeamStatusCommand("complete_task", "default", "T-001", "Done with tests.")
            ],
            [],
            [],
            [],
            []);

        await store.AppendForwardedAgentHubCommandsAsync(@"V:\OrderManager", result);

        var events = await store.ListAsync(@"V:\OrderManager");
        Assert.Equal(2, events.Count);
        Assert.All(events, item =>
        {
            Assert.Equal(CollaborationEventKind.UserMessage, item.Kind);
            Assert.Equal("agenthub", item.ProfileId);
            Assert.Equal("team-status", item.TargetProfileId);
        });
        Assert.Equal("[claim_task default/T-001] claimed", events[0].Message);
        Assert.Equal("[complete_task default/T-001] Done with tests.", events[1].Message);
    }

    [Fact]
    public async Task Appends_workflow_commands_as_agenthub_timeline_messages()
    {
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var result = new AgentHubCommandDispatchResult(
            0,
            [],
            [],
            [],
            [
                new AgentHubWorkflowCommand("ask_user", "Which workspace should I use?"),
                new AgentHubWorkflowCommand("done", null)
            ],
            [],
            [],
            []);

        await store.AppendForwardedAgentHubCommandsAsync(@"V:\OrderManager", result);

        var events = await store.ListAsync(@"V:\OrderManager");
        Assert.Equal(2, events.Count);
        Assert.All(events, item =>
        {
            Assert.Equal(CollaborationEventKind.UserMessage, item.Kind);
            Assert.Equal("agenthub", item.ProfileId);
            Assert.Equal("workflow", item.TargetProfileId);
        });
        Assert.Equal("[ask_user] Which workspace should I use?", events[0].Message);
        Assert.Equal("[done] completed", events[1].Message);
    }

    [Fact]
    public async Task Appends_pair_negotiation_commands_as_agenthub_timeline_messages()
    {
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var result = new AgentHubCommandDispatchResult(
            0,
            [],
            [],
            [],
            [],
            [
                new AgentHubPairNegotiationCommand(
                    "continue",
                    2,
                    "Please review version 2.",
                    null,
                    "codex",
                    "Version 2 adds tests.",
                    "revise"),
                new AgentHubPairNegotiationCommand(
                    "accept",
                    2,
                    null,
                    "negotiation/proposal-v2.md",
                    null,
                    "Version 2 is ready.",
                    "accepted")
            ],
            [],
            []);

        await store.AppendForwardedAgentHubCommandsAsync(@"V:\OrderManager", result);

        var events = await store.ListAsync(@"V:\OrderManager");
        Assert.Equal(2, events.Count);
        Assert.All(events, item =>
        {
            Assert.Equal(CollaborationEventKind.UserMessage, item.Kind);
            Assert.Equal("agenthub", item.ProfileId);
            Assert.Equal("pair-negotiation", item.TargetProfileId);
        });
        Assert.Equal("[continue v2] Please review version 2.", events[0].Message);
        Assert.Equal("[accept v2] Version 2 is ready.", events[1].Message);
    }

    [Fact]
    public async Task Appends_parse_and_dispatch_errors_as_agenthub_command_error_events()
    {
        var store = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var result = new AgentHubCommandDispatchResult(
            0,
            [],
            [],
            [],
            [],
            [],
            [new AgentHubCommandParseError(0, "invalid_json", "Invalid JSON in agenthub command block", "{\"action\":")],
            [new AgentHubCommandDispatchError("codex", "No active session for profile 'codex'.")]);

        await store.AppendForwardedAgentHubCommandsAsync(@"V:\OrderManager", result);

        var events = await store.ListAsync(@"V:\OrderManager");
        Assert.Equal(2, events.Count);
        Assert.All(events, item =>
        {
            Assert.Equal(CollaborationEventKind.AgentHubCommandError, item.Kind);
            Assert.Equal("agenthub", item.ProfileId);
            Assert.Equal("command-error", item.TargetProfileId);
        });
        Assert.Equal("[parse_error invalid_json #0] Invalid JSON in agenthub command block", events[0].Message);
        Assert.Equal("[dispatch_error codex] No active session for profile 'codex'.", events[1].Message);
    }

    public void Dispose()
    {
        if (Directory.Exists(tempRoot))
        {
            Directory.Delete(tempRoot, recursive: true);
        }
    }
}
