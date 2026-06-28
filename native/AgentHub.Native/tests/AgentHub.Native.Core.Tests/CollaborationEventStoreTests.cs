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
            []);

        await store.AppendForwardedAgentHubCommandsAsync(@"V:\OrderManager", result);

        var item = Assert.Single(await store.ListAsync(@"V:\OrderManager"));
        Assert.Equal(CollaborationEventKind.UserMessage, item.Kind);
        Assert.Equal("agenthub", item.ProfileId);
        Assert.Equal("codex", item.TargetProfileId);
        Assert.Equal("Please inspect.", item.Message);
    }

    public void Dispose()
    {
        if (Directory.Exists(tempRoot))
        {
            Directory.Delete(tempRoot, recursive: true);
        }
    }
}
