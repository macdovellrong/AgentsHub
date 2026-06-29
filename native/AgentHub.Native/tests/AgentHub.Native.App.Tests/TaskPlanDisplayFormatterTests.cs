using AgentHub.Native.App;
using AgentHub.Native.Core.TaskPlans;

namespace AgentHub.Native.App.Tests;

public sealed class TaskPlanDisplayFormatterTests
{
    [Fact]
    public void Formats_task_with_status_assignee_attempt_and_artifact()
    {
        var task = new AgentTaskPlanTask(
            "T-001",
            "T-001",
            "review",
            "codex",
            2,
            "Implementation done.",
            "run-2",
            "artifacts/T-001-codex-run-2.md",
            DateTimeOffset.Parse("2026-06-29T12:34:56Z"));

        var text = TaskPlanDisplayFormatter.FormatTask(task);

        Assert.Equal("T-001 | review | codex | attempt 2 | artifacts/T-001-codex-run-2.md | Implementation done.", text);
    }

    [Fact]
    public void Formats_event_with_route_artifact_and_message()
    {
        var localTimeZone = TimeZoneInfo.FindSystemTimeZoneById("UTC");
        var item = new AgentTaskPlanLogEvent(
            "event-1",
            "hook_completed",
            DateTimeOffset.Parse("2026-06-29T12:34:56Z"),
            "T-001",
            "codex",
            "claude",
            "Implementation done.",
            "artifacts/T-001-codex-run-2.md",
            "codex-1",
            "run-2",
            "source-1");

        var text = TaskPlanDisplayFormatter.FormatEvent(item, localTimeZone);

        Assert.Equal("12:34:56 | hook_completed | T-001 | codex -> claude | artifacts/T-001-codex-run-2.md | Implementation done.", text);
    }
}
