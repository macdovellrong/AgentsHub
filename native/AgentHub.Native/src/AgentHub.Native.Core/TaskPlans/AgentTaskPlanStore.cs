using System.Text.Json;

namespace AgentHub.Native.Core.TaskPlans;

public sealed class AgentTaskPlanStore
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    private static readonly JsonSerializerOptions JsonlSerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    private readonly AgentTaskPlanStoreOptions options;

    public AgentTaskPlanStore()
        : this(new AgentTaskPlanStoreOptions())
    {
    }

    public AgentTaskPlanStore(AgentTaskPlanStoreOptions options)
    {
        this.options = options;
    }

    public async Task<IReadOnlyList<AgentTaskPlanSource>> ListSourceTasksAsync(
        string workspacePath,
        CancellationToken cancellationToken = default)
    {
        var rootPath = SourceRootPath(workspacePath);
        if (!Directory.Exists(rootPath))
        {
            return [];
        }

        var sources = new List<AgentTaskPlanSource>();
        foreach (var directory in Directory.EnumerateDirectories(rootPath))
        {
            var directoryName = Path.GetFileName(directory);
            if (!IsSafeTaskSourceDirectoryName(directoryName))
            {
                continue;
            }

            var sourcePlanPath = Path.Combine(directory, "task-plan.md");
            string markdown;
            try
            {
                markdown = await ReadSourceTaskPlanMarkdownAsync(sourcePlanPath, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (InvalidOperationException)
            {
                continue;
            }

            sources.Add(new AgentTaskPlanSource(
                directoryName,
                ExtractMarkdownTitle(markdown) ?? directoryName,
                directory,
                sourcePlanPath));
        }

        return sources
            .OrderBy(source => source.DirectoryName, StringComparer.Ordinal)
            .ToList();
    }

    public async Task<AgentTaskPlan> CreatePlanAsync(
        string workspacePath,
        CreateAgentTaskPlanRequest request,
        CancellationToken cancellationToken = default)
    {
        var sourceTaskDir = SourceTaskDirPath(workspacePath, request.SourceTaskDirectoryName);
        var sourcePlanPath = Path.Combine(sourceTaskDir, "task-plan.md");
        var markdown = await ReadSourceTaskPlanMarkdownAsync(sourcePlanPath, cancellationToken)
            .ConfigureAwait(false);
        var now = UtcNow();
        var timestamp = now.UtcDateTime;
        var date = timestamp.ToString("yyyy-MM-dd");
        var time = timestamp.ToString("HHmmss");
        var title = string.IsNullOrWhiteSpace(request.Title) ? "Task Plan" : request.Title.Trim();
        var slug = Slugify(title);
        var directoryName = $"{time}-{slug}";
        var datePath = Path.Combine(RootPath(workspacePath), date);
        var planPath = Path.Combine(datePath, directoryName);
        if (Directory.Exists(planPath))
        {
            throw new InvalidOperationException($"Task plan already exists: {date.Replace("-", "", StringComparison.Ordinal)}-{time}-{slug}");
        }

        var plan = new AgentTaskPlan(
            $"{date.Replace("-", "", StringComparison.Ordinal)}-{time}-{slug}",
            title,
            "draft",
            request.ManagerProfileId,
            request.ParticipantProfileIds.ToArray(),
            date,
            directoryName,
            planPath,
            sourceTaskDir,
            sourcePlanPath,
            now,
            now);

        Directory.CreateDirectory(datePath);
        Directory.CreateDirectory(planPath);
        Directory.CreateDirectory(Path.Combine(planPath, "artifacts"));
        await WriteTextAsync(Path.Combine(planPath, "plan.json"), $"{JsonSerializer.Serialize(plan, SerializerOptions)}\n", cancellationToken)
            .ConfigureAwait(false);
        await WriteTextAsync(Path.Combine(planPath, "task-plan.md"), markdown, cancellationToken)
            .ConfigureAwait(false);
        await WriteTextAsync(Path.Combine(planPath, "tasks.jsonl"), string.Empty, cancellationToken)
            .ConfigureAwait(false);
        await WriteTextAsync(Path.Combine(planPath, "events.jsonl"), string.Empty, cancellationToken)
            .ConfigureAwait(false);

        return plan;
    }

    public async Task<IReadOnlyList<AgentTaskPlan>> ListPlansAsync(
        string workspacePath,
        CancellationToken cancellationToken = default)
    {
        var rootPath = RootPath(workspacePath);
        if (!Directory.Exists(rootPath))
        {
            return [];
        }

        var plans = new List<AgentTaskPlan>();
        foreach (var dateDirectory in Directory.EnumerateDirectories(rootPath))
        {
            foreach (var planDirectory in Directory.EnumerateDirectories(dateDirectory))
            {
                var plan = await ReadPlanAsync(workspacePath, rootPath, planDirectory, cancellationToken)
                    .ConfigureAwait(false);
                if (plan is not null)
                {
                    plans.Add(plan);
                }
            }
        }

        return plans
            .OrderByDescending(plan => plan.CreatedAt)
            .ToList();
    }

    public async Task<AgentTaskPlan> GetPlanAsync(
        string workspacePath,
        string planId,
        CancellationToken cancellationToken = default)
    {
        var plan = (await ListPlansAsync(workspacePath, cancellationToken).ConfigureAwait(false))
            .FirstOrDefault(candidate => string.Equals(candidate.Id, planId, StringComparison.Ordinal));
        return plan ?? throw new InvalidOperationException($"Unknown task plan: {planId}");
    }

    public async Task<string> ReadMarkdownAsync(
        string workspacePath,
        string planId,
        CancellationToken cancellationToken = default)
    {
        var plan = await GetPlanAsync(workspacePath, planId, cancellationToken).ConfigureAwait(false);
        return await File.ReadAllTextAsync(Path.Combine(plan.PlanPath, "task-plan.md"), cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<AgentTaskPlan> UpdatePlanStatusAsync(
        string workspacePath,
        string planId,
        string status,
        CancellationToken cancellationToken = default)
    {
        if (!IsKnownStatus(status))
        {
            throw new ArgumentException($"Unknown task plan status: {status}", nameof(status));
        }

        var plan = await GetPlanAsync(workspacePath, planId, cancellationToken).ConfigureAwait(false);
        var updated = plan with
        {
            Status = status,
            UpdatedAt = UtcNow()
        };
        await WritePlanAsync(updated, cancellationToken).ConfigureAwait(false);
        return updated;
    }

    public async Task<AgentTaskPlanLogEvent> AppendEventAsync(
        string workspacePath,
        string planId,
        AgentTaskPlanLogEventInput input,
        CancellationToken cancellationToken = default)
    {
        var plan = await GetPlanAsync(workspacePath, planId, cancellationToken).ConfigureAwait(false);
        var item = new AgentTaskPlanLogEvent(
            Guid.NewGuid().ToString("N"),
            input.Type,
            UtcNow(),
            input.TaskId,
            input.FromProfileId,
            input.ToProfileId,
            input.Message,
            input.SessionId,
            input.RunId,
            input.SourceEventId);
        var json = JsonSerializer.Serialize(item, JsonlSerializerOptions);
        await File.AppendAllTextAsync(EventsPath(plan.PlanPath), $"{json}\n", cancellationToken)
            .ConfigureAwait(false);
        return item;
    }

    public async Task<IReadOnlyList<AgentTaskPlanLogEvent>> ListEventsAsync(
        string workspacePath,
        string planId,
        CancellationToken cancellationToken = default)
    {
        var plan = await GetPlanAsync(workspacePath, planId, cancellationToken).ConfigureAwait(false);
        var filePath = EventsPath(plan.PlanPath);
        if (!File.Exists(filePath))
        {
            return [];
        }

        var events = new List<AgentTaskPlanLogEvent>();
        var lines = await File.ReadAllLinesAsync(filePath, cancellationToken).ConfigureAwait(false);
        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            try
            {
                var item = JsonSerializer.Deserialize<AgentTaskPlanLogEvent>(line, JsonlSerializerOptions);
                if (item is not null)
                {
                    events.Add(item);
                }
            }
            catch (JsonException)
            {
                // Execution event logs are append-only; skip partial or damaged lines.
            }
        }

        return events;
    }

    private async Task<AgentTaskPlan?> ReadPlanAsync(
        string workspacePath,
        string rootPath,
        string planPath,
        CancellationToken cancellationToken)
    {
        if (!IsPathInsideOrEqual(planPath, rootPath))
        {
            return null;
        }

        var filePath = Path.Combine(planPath, "plan.json");
        if (!File.Exists(filePath))
        {
            return null;
        }

        var json = await File.ReadAllTextAsync(filePath, cancellationToken).ConfigureAwait(false);
        AgentTaskPlan? plan;
        try
        {
            plan = JsonSerializer.Deserialize<AgentTaskPlan>(json, SerializerOptions);
        }
        catch (JsonException)
        {
            return null;
        }

        if (plan is null || !IsKnownStatus(plan.Status))
        {
            return null;
        }

        var sourceTaskDir = string.IsNullOrWhiteSpace(plan.SourceTaskDir)
            ? SourceRootPath(workspacePath)
            : plan.SourceTaskDir;
        var sourcePlanPath = string.IsNullOrWhiteSpace(plan.SourcePlanPath)
            ? Path.Combine(sourceTaskDir, "task-plan.md")
            : plan.SourcePlanPath;

        return plan with
        {
            PlanPath = planPath,
            SourceTaskDir = sourceTaskDir,
            SourcePlanPath = sourcePlanPath
        };
    }

    private static async Task<string> ReadSourceTaskPlanMarkdownAsync(
        string sourcePlanPath,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(sourcePlanPath))
        {
            throw new InvalidOperationException($"Task source task-plan.md not found: {sourcePlanPath}");
        }

        var markdown = await File.ReadAllTextAsync(sourcePlanPath, cancellationToken).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(markdown))
        {
            throw new InvalidOperationException($"Task source task-plan.md is empty: {sourcePlanPath}");
        }

        return markdown;
    }

    private static async Task WriteTextAsync(string path, string content, CancellationToken cancellationToken)
    {
        await File.WriteAllTextAsync(path, content, cancellationToken).ConfigureAwait(false);
    }

    private static async Task WritePlanAsync(AgentTaskPlan plan, CancellationToken cancellationToken)
    {
        await WriteTextAsync(
            Path.Combine(plan.PlanPath, "plan.json"),
            $"{JsonSerializer.Serialize(plan, SerializerOptions)}\n",
            cancellationToken).ConfigureAwait(false);
    }

    private static string EventsPath(string planPath)
    {
        return Path.Combine(planPath, "events.jsonl");
    }

    private DateTimeOffset UtcNow()
    {
        return options.UtcNow?.Invoke().ToUniversalTime() ?? DateTimeOffset.UtcNow;
    }

    private static string RootPath(string workspacePath)
    {
        return Path.Combine(workspacePath, ".agenthub", "task-plans");
    }

    private static string SourceRootPath(string workspacePath)
    {
        return Path.Combine(workspacePath, "tasks");
    }

    private static string SourceTaskDirPath(string workspacePath, string directoryName)
    {
        if (!IsSafeTaskSourceDirectoryName(directoryName))
        {
            throw new ArgumentException("Invalid task source directory", nameof(directoryName));
        }

        return Path.Combine(SourceRootPath(workspacePath), directoryName);
    }

    private static string? ExtractMarkdownTitle(string markdown)
    {
        foreach (var line in markdown.Split(["\r\n", "\n"], StringSplitOptions.None))
        {
            if (!line.StartsWith("# ", StringComparison.Ordinal))
            {
                continue;
            }

            var title = line[2..].Trim();
            if (title.Length > 0)
            {
                return title;
            }
        }

        return null;
    }

    private static bool IsSafeTaskSourceDirectoryName(string directoryName)
    {
        return !string.IsNullOrWhiteSpace(directoryName) &&
               directoryName is not "." and not ".." &&
               !directoryName.Contains(Path.DirectorySeparatorChar, StringComparison.Ordinal) &&
               !directoryName.Contains(Path.AltDirectorySeparatorChar, StringComparison.Ordinal);
    }

    private static bool IsPathInsideOrEqual(string candidatePath, string rootPath)
    {
        var relativePath = Path.GetRelativePath(Path.GetFullPath(rootPath), Path.GetFullPath(candidatePath));
        return relativePath == "." ||
               (!relativePath.StartsWith("..", StringComparison.Ordinal) && !Path.IsPathRooted(relativePath));
    }

    private static bool IsKnownStatus(string status)
    {
        return status is "draft" or "running" or "paused" or "completed" or "failed" or "archived";
    }

    private static string Slugify(string value)
    {
        var chars = value
            .Trim()
            .ToLowerInvariant()
            .Select(character => char.IsAsciiLetterOrDigit(character) ? character : '-')
            .ToArray();
        var collapsed = string.Join(
            "-",
            new string(chars)
                .Split('-', StringSplitOptions.RemoveEmptyEntries));
        return string.IsNullOrWhiteSpace(collapsed) ? "task-plan" : collapsed;
    }
}
