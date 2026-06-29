namespace AgentHub.Native.Core.Collaboration;

public static class CollaborationTimelineFormatter
{
    public static string Format(CollaborationEvent item, TimeZoneInfo timeZone)
    {
        var timestamp = TimeZoneInfo.ConvertTime(item.Timestamp, timeZone).ToString("HH:mm:ss");
        return item.Kind switch
        {
            CollaborationEventKind.UserMessage => $"{timestamp} {item.ProfileId ?? "user"} -> {item.TargetProfileId ?? "selected"}: {item.Message}",
            CollaborationEventKind.AgentOutput => $"{timestamp} {item.ProfileId ?? item.Source ?? "agent"}: {item.Message}",
            CollaborationEventKind.AgentHubCommandError => $"{timestamp} agenthub command error: {item.Message}",
            _ => $"{timestamp} {item.Message}"
        };
    }
}
