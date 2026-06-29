using System.Text.Json;

namespace AgentHub.Native.Core.Collaboration;

public sealed class AgentConversationStore(AgentConversationStoreOptions? options = null)
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        WriteIndented = false
    };

    private readonly AgentConversationStoreOptions options = options ?? new AgentConversationStoreOptions();
    private readonly Dictionary<string, Task> queues = new(StringComparer.OrdinalIgnoreCase);

    public Task<AgentConversation> CreateAsync(
        string workspacePath,
        CreateAgentConversationRequest request,
        CancellationToken cancellationToken = default)
    {
        return EnqueueAsync(workspacePath, async () =>
        {
            var id = string.IsNullOrWhiteSpace(request.Id)
                ? Guid.NewGuid().ToString("N")
                : request.Id;
            if ((await ListAsync(workspacePath, cancellationToken).ConfigureAwait(false))
                .Any(conversation => string.Equals(conversation.Id, id, StringComparison.Ordinal)))
            {
                throw new InvalidOperationException($"Conversation already exists: {id}");
            }

            var now = options.UtcNow();
            var createdAt = request.CreatedAt ?? now;
            var conversation = new AgentConversation(
                id,
                request.Mode,
                request.Status ?? "running",
                request.SupervisorProfileId,
                request.ParticipantProfileIds.ToArray(),
                request.Topic,
                request.CurrentStep,
                request.MaxSteps,
                createdAt,
                request.UpdatedAt ?? createdAt);
            ValidateConversation(conversation);
            await AppendAsync(workspacePath, conversation, cancellationToken).ConfigureAwait(false);
            return conversation;
        });
    }

    public Task<AgentConversation> UpdateAsync(
        string workspacePath,
        string conversationId,
        UpdateAgentConversationRequest request,
        CancellationToken cancellationToken = default)
    {
        return EnqueueAsync(workspacePath, async () =>
        {
            var existing = (await ListAsync(workspacePath, cancellationToken).ConfigureAwait(false))
                .FirstOrDefault(conversation => string.Equals(conversation.Id, conversationId, StringComparison.Ordinal));
            if (existing is null)
            {
                throw new InvalidOperationException($"Unknown conversation: {conversationId}");
            }

            var updated = existing with
            {
                Status = request.Status ?? existing.Status,
                SupervisorProfileId = request.SupervisorProfileId ?? existing.SupervisorProfileId,
                ParticipantProfileIds = request.ParticipantProfileIds?.ToArray() ?? existing.ParticipantProfileIds,
                Topic = request.Topic ?? existing.Topic,
                CurrentStep = request.CurrentStep ?? existing.CurrentStep,
                MaxSteps = request.MaxSteps ?? existing.MaxSteps,
                UpdatedAt = request.UpdatedAt ?? options.UtcNow()
            };
            ValidateConversation(updated);
            await AppendAsync(workspacePath, updated, cancellationToken).ConfigureAwait(false);
            return updated;
        });
    }

    public async Task<IReadOnlyList<AgentConversation>> ListAsync(
        string workspacePath,
        CancellationToken cancellationToken = default)
    {
        var filePath = ConversationPath(workspacePath);
        if (!File.Exists(filePath))
        {
            return [];
        }

        var latestById = new Dictionary<string, AgentConversation>(StringComparer.Ordinal);
        var lines = await File.ReadAllLinesAsync(filePath, cancellationToken).ConfigureAwait(false);
        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            try
            {
                var conversation = JsonSerializer.Deserialize<AgentConversation>(line, SerializerOptions);
                if (conversation is not null && IsValidConversation(conversation))
                {
                    latestById[conversation.Id] = conversation;
                }
            }
            catch (JsonException)
            {
            }
        }

        return latestById.Values
            .OrderByDescending(conversation => conversation.UpdatedAt)
            .ToList();
    }

    private Task<T> EnqueueAsync<T>(string workspacePath, Func<Task<T>> operation)
    {
        var key = NormalizeWorkspace(workspacePath).ToLowerInvariant();
        var previous = queues.TryGetValue(key, out var existing) ? existing : Task.CompletedTask;
        async Task<T> RunAsync()
        {
            try
            {
                await previous.ConfigureAwait(false);
            }
            catch
            {
            }

            return await operation().ConfigureAwait(false);
        }

        var next = RunAsync();
        queues[key] = next;
        _ = next.ContinueWith(
            _ =>
            {
                if (ReferenceEquals(queues.GetValueOrDefault(key), next))
                {
                    queues.Remove(key);
                }
            },
            TaskScheduler.Default);
        return next;
    }

    private async Task AppendAsync(
        string workspacePath,
        AgentConversation conversation,
        CancellationToken cancellationToken)
    {
        var filePath = ConversationPath(workspacePath);
        Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
        var json = JsonSerializer.Serialize(conversation, SerializerOptions);
        await File.AppendAllTextAsync(filePath, $"{json}\n", cancellationToken).ConfigureAwait(false);
    }

    private static string ConversationPath(string workspacePath)
    {
        return Path.Combine(NormalizeWorkspace(workspacePath), ".agenthub", "conversations", "conversations.jsonl");
    }

    private static string NormalizeWorkspace(string workspacePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(workspacePath);
        return workspacePath.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private static void ValidateConversation(AgentConversation conversation)
    {
        if (!IsValidConversation(conversation))
        {
            throw new InvalidOperationException($"Invalid conversation: {conversation.Id}");
        }
    }

    private static bool IsValidConversation(AgentConversation conversation)
    {
        return !string.IsNullOrWhiteSpace(conversation.Id) &&
               conversation.Mode is "manager" or "roundtable" or "pair_negotiation" &&
               conversation.Status is "running" or "paused" or "completed" or "failed" or "stopped" &&
               !string.IsNullOrWhiteSpace(conversation.Topic) &&
               conversation.CurrentStep >= 0 &&
               (conversation.MaxSteps is null or >= 0) &&
               conversation.ParticipantProfileIds.All(profileId => !string.IsNullOrWhiteSpace(profileId));
    }
}
