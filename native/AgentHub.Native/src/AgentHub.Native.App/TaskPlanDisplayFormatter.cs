using AgentHub.Native.Core.TaskPlans;

namespace AgentHub.Native.App;

public static class TaskPlanDisplayFormatter
{
    public static string FormatTask(AgentTaskPlanTask task)
    {
        var parts = new List<string>
        {
            task.Id,
            task.Status,
            string.IsNullOrWhiteSpace(task.AssigneeProfileId) ? "-" : task.AssigneeProfileId,
            $"attempt {task.Attempt}"
        };
        AddIfPresent(parts, task.ArtifactPath);
        AddIfPresent(parts, OneLine(task.Description));
        return string.Join(" | ", parts);
    }

    public static string FormatEvent(AgentTaskPlanLogEvent item, TimeZoneInfo timeZone)
    {
        var localTime = TimeZoneInfo.ConvertTime(item.Timestamp, timeZone);
        var parts = new List<string>
        {
            localTime.ToString("HH:mm:ss"),
            item.Type
        };
        AddIfPresent(parts, item.TaskId);
        AddIfPresent(parts, Route(item.FromProfileId, item.ToProfileId));
        AddIfPresent(parts, item.ArtifactPath);
        AddIfPresent(parts, OneLine(item.Message));
        return string.Join(" | ", parts);
    }

    private static string? Route(string? fromProfileId, string? toProfileId)
    {
        if (!string.IsNullOrWhiteSpace(fromProfileId) && !string.IsNullOrWhiteSpace(toProfileId))
        {
            return $"{fromProfileId} -> {toProfileId}";
        }

        return !string.IsNullOrWhiteSpace(fromProfileId)
            ? fromProfileId
            : toProfileId;
    }

    private static string? OneLine(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value
            .Replace("\r\n", " ", StringComparison.Ordinal)
            .Replace('\r', ' ')
            .Replace('\n', ' ')
            .Trim();
    }

    private static void AddIfPresent(List<string> parts, string? value)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            parts.Add(value);
        }
    }
}
