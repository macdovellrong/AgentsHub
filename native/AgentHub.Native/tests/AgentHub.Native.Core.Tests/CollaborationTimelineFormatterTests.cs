using AgentHub.Native.Core.Collaboration;

namespace AgentHub.Native.Core.Tests;

public sealed class CollaborationTimelineFormatterTests
{
    [Fact]
    public void Formats_user_messages_with_target_profile()
    {
        var item = new CollaborationEvent(
            "event-1",
            new DateTimeOffset(2026, 6, 29, 8, 30, 10, TimeSpan.Zero),
            CollaborationEventKind.UserMessage,
            @"V:\OrderManager",
            "please inspect",
            "user",
            "codex",
            null,
            null,
            "user");

        var line = CollaborationTimelineFormatter.Format(item, TimeZoneInfo.Utc);

        Assert.Equal("08:30:10 user -> codex: please inspect", line);
    }

    [Fact]
    public void Formats_agent_outputs_with_profile_or_source()
    {
        var item = new CollaborationEvent(
            "event-2",
            new DateTimeOffset(2026, 6, 29, 9, 2, 3, TimeSpan.Zero),
            CollaborationEventKind.AgentOutput,
            @"V:\OrderManager",
            "done",
            null,
            null,
            "codex-1",
            "run-1",
            "codex");

        var line = CollaborationTimelineFormatter.Format(item, TimeZoneInfo.Utc);

        Assert.Equal("09:02:03 codex: done", line);
    }

    [Fact]
    public void Formats_agenthub_command_errors()
    {
        var item = new CollaborationEvent(
            "event-3",
            new DateTimeOffset(2026, 6, 29, 9, 5, 0, TimeSpan.Zero),
            CollaborationEventKind.AgentHubCommandError,
            @"V:\OrderManager",
            "[dispatch_error codex] No active session",
            "agenthub",
            "command-error",
            null,
            null,
            "agenthub");

        var line = CollaborationTimelineFormatter.Format(item, TimeZoneInfo.Utc);

        Assert.Equal("09:05:00 agenthub command error: [dispatch_error codex] No active session", line);
    }
}
