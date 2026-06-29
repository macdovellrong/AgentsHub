using System.Text.Json;

namespace AgentHub.Native.Core.Collaboration;

public sealed class AgentTaskStore
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    public async Task<IReadOnlyList<AgentTask>> ListAsync(
        string workspacePath,
        CancellationToken cancellationToken = default)
    {
        var filePath = TaskPath(workspacePath);
        if (!File.Exists(filePath))
        {
            return [];
        }

        var tasks = new Dictionary<string, AgentTask>(StringComparer.Ordinal);
        var lines = await File.ReadAllLinesAsync(filePath, cancellationToken).ConfigureAwait(false);
        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            var task = JsonSerializer.Deserialize<AgentTask>(line, SerializerOptions);
            if (task is not null)
            {
                tasks[task.Id] = task;
            }
        }

        return tasks.Values.ToList();
    }

    public async Task<AgentTask> CreateAsync(
        string workspacePath,
        AgentTaskCreateRequest request,
        CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        var task = new AgentTask(
            Guid.NewGuid().ToString("N"),
            request.Title,
            request.Description,
            string.IsNullOrWhiteSpace(request.Status) ? "pending" : request.Status,
            request.ProfileId,
            request.RunId,
            now,
            now);
        await AppendAsync(workspacePath, task, cancellationToken).ConfigureAwait(false);
        return task;
    }

    public async Task<AgentTask> UpdateAsync(
        string workspacePath,
        string taskId,
        AgentTaskUpdateRequest request,
        CancellationToken cancellationToken = default)
    {
        var existing = (await ListAsync(workspacePath, cancellationToken).ConfigureAwait(false))
            .FirstOrDefault(task => string.Equals(task.Id, taskId, StringComparison.Ordinal));
        if (existing is null)
        {
            throw new InvalidOperationException($"Unknown task: {taskId}");
        }

        var updated = existing with
        {
            Title = request.Title ?? existing.Title,
            Description = request.Description ?? existing.Description,
            Status = request.Status ?? existing.Status,
            ProfileId = request.ProfileId ?? existing.ProfileId,
            RunId = request.RunId ?? existing.RunId,
            UpdatedAt = DateTimeOffset.UtcNow
        };
        await AppendAsync(workspacePath, updated, cancellationToken).ConfigureAwait(false);
        return updated;
    }

    private static async Task AppendAsync(
        string workspacePath,
        AgentTask task,
        CancellationToken cancellationToken)
    {
        var filePath = TaskPath(workspacePath);
        Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
        var json = JsonSerializer.Serialize(task, SerializerOptions);
        await File.AppendAllTextAsync(filePath, $"{json}\n", cancellationToken).ConfigureAwait(false);
    }

    private static string TaskPath(string workspacePath)
    {
        return Path.Combine(workspacePath, ".agenthub", "tasks", "tasks.jsonl");
    }
}
