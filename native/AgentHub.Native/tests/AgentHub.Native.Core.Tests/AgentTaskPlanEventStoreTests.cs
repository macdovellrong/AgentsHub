using AgentHub.Native.Core.Collaboration;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentTaskPlanEventStoreTests : IDisposable
{
    private readonly string workspacePath = Path.Combine(
        Path.GetTempPath(),
        "agenthub-native-task-plan-events",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Appends_and_lists_task_plan_events_by_plan_id()
    {
        var store = new AgentTaskPlanEventStore();

        var stored = await store.AppendEventAsync(workspacePath, new AgentTaskPlanEventRequest(
            "P-001",
            "approved",
            "T-001",
            "claude",
            null,
            "Accepted",
            "claude-1",
            "run-1",
            "event-1"));
        await File.AppendAllTextAsync(
            Path.Combine(workspacePath, ".agenthub", "task-plans", "native", "P-001", "events.jsonl"),
            "{ broken json\n");

        var events = await store.ListEventsAsync(workspacePath, "P-001");
        var rawEvents = await File.ReadAllTextAsync(
            Path.Combine(workspacePath, ".agenthub", "task-plans", "native", "P-001", "events.jsonl"));

        var item = Assert.Single(events);
        Assert.Equal(stored.Id, item.Id);
        Assert.Equal("P-001", item.PlanId);
        Assert.Equal("approved", item.Type);
        Assert.Equal("T-001", item.TaskId);
        Assert.Equal("claude", item.FromProfileId);
        Assert.Equal("Accepted", item.Message);
        Assert.Equal("claude-1", item.SessionId);
        Assert.Equal("run-1", item.RunId);
        Assert.Equal("event-1", item.SourceEventId);
        Assert.Contains("\"planId\":\"P-001\"", rawEvents);
    }

    public void Dispose()
    {
        if (Directory.Exists(workspacePath))
        {
            Directory.Delete(workspacePath, recursive: true);
        }
    }
}
