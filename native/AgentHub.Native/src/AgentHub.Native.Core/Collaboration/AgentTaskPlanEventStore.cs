using System.Text.Json;

namespace AgentHub.Native.Core.Collaboration;

public sealed class AgentTaskPlanEventStore
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    public async Task<AgentTaskPlanEvent> AppendEventAsync(
        string workspacePath,
        AgentTaskPlanEventRequest request,
        CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        var taskPlanEvent = new AgentTaskPlanEvent(
            Guid.NewGuid().ToString("N"),
            request.PlanId,
            request.Type,
            now,
            request.TaskId,
            request.FromProfileId,
            request.ToProfileId,
            request.Message,
            request.SessionId,
            request.RunId,
            request.SourceEventId);
        var filePath = EventsPath(workspacePath, request.PlanId);
        Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
        var json = JsonSerializer.Serialize(taskPlanEvent, SerializerOptions);
        await File.AppendAllTextAsync(filePath, $"{json}\n", cancellationToken).ConfigureAwait(false);
        return taskPlanEvent;
    }

    public async Task<IReadOnlyList<AgentTaskPlanEvent>> ListEventsAsync(
        string workspacePath,
        string planId,
        CancellationToken cancellationToken = default)
    {
        var filePath = EventsPath(workspacePath, planId);
        if (!File.Exists(filePath))
        {
            return [];
        }

        var events = new List<AgentTaskPlanEvent>();
        var lines = await File.ReadAllLinesAsync(filePath, cancellationToken).ConfigureAwait(false);
        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            try
            {
                var item = JsonSerializer.Deserialize<AgentTaskPlanEvent>(line, SerializerOptions);
                if (item is not null)
                {
                    events.Add(item);
                }
            }
            catch (JsonException)
            {
                // Task-plan event logs are append-only; ignore partial or damaged lines.
            }
        }

        return events;
    }

    private static string EventsPath(string workspacePath, string planId)
    {
        return Path.Combine(
            workspacePath,
            ".agenthub",
            "task-plans",
            "native",
            SanitizePlanId(planId),
            "events.jsonl");
    }

    private static string SanitizePlanId(string planId)
    {
        var sanitized = new string(planId.Select(character =>
            char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '-'
                ? character
                : '_').ToArray());
        return string.IsNullOrWhiteSpace(sanitized) ? "unknown-plan" : sanitized;
    }
}
