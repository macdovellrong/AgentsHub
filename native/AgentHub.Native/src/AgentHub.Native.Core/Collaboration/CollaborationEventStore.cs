using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AgentHub.Native.Core.Hooks;

namespace AgentHub.Native.Core.Collaboration;

public sealed class CollaborationEventStore(string rootDirectory)
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        WriteIndented = false
    };

    public Task<CollaborationEvent> AppendUserMessageAsync(
        CollaborationUserMessage message,
        CancellationToken cancellationToken = default)
    {
        var collaborationEvent = new CollaborationEvent(
            Guid.NewGuid().ToString("N"),
            DateTimeOffset.UtcNow,
            CollaborationEventKind.UserMessage,
            NormalizePath(message.WorkspacePath),
            message.Message,
            message.ProfileId,
            message.TargetProfileId,
            null,
            null,
            "user");
        return AppendAsync(collaborationEvent, cancellationToken);
    }

    public Task<CollaborationEvent> AppendAgentOutputAsync(
        AgentHookEvent hookEvent,
        CancellationToken cancellationToken = default)
    {
        var collaborationEvent = new CollaborationEvent(
            Guid.NewGuid().ToString("N"),
            DateTimeOffset.UtcNow,
            CollaborationEventKind.AgentOutput,
            NormalizePath(hookEvent.Workspace),
            hookEvent.Message,
            hookEvent.ProfileId,
            null,
            hookEvent.SessionId,
            hookEvent.RunId,
            hookEvent.Source);
        return AppendAsync(collaborationEvent, cancellationToken);
    }

    public async Task<IReadOnlyList<CollaborationEvent>> AppendForwardedAgentHubCommandsAsync(
        string workspacePath,
        AgentHubCommandDispatchResult result,
        CancellationToken cancellationToken = default)
    {
        var events = new List<CollaborationEvent>();
        foreach (var message in result.SentMessages)
        {
            events.Add(await AppendUserMessageAsync(
                new CollaborationUserMessage(workspacePath, "agenthub", message.To, message.Message),
                cancellationToken).ConfigureAwait(false));
        }

        foreach (var command in result.PlanStatusCommands)
        {
            events.Add(await AppendUserMessageAsync(
                new CollaborationUserMessage(
                    workspacePath,
                    "agenthub",
                    "task-plan",
                    FormatPlanStatusCommand(command)),
                cancellationToken).ConfigureAwait(false));
        }

        foreach (var command in result.TeamStatusCommands)
        {
            events.Add(await AppendUserMessageAsync(
                new CollaborationUserMessage(
                    workspacePath,
                    "agenthub",
                    "team-status",
                    FormatTeamStatusCommand(command)),
                cancellationToken).ConfigureAwait(false));
        }

        foreach (var error in result.ParseErrors)
        {
            events.Add(await AppendCommandErrorAsync(
                workspacePath,
                $"[parse_error {error.Code} #{error.Index}] {error.Message}",
                cancellationToken).ConfigureAwait(false));
        }

        foreach (var error in result.DispatchErrors)
        {
            events.Add(await AppendCommandErrorAsync(
                workspacePath,
                $"[dispatch_error {error.TargetProfileId}] {error.Message}",
                cancellationToken).ConfigureAwait(false));
        }

        return events;
    }

    private Task<CollaborationEvent> AppendCommandErrorAsync(
        string workspacePath,
        string message,
        CancellationToken cancellationToken = default)
    {
        var collaborationEvent = new CollaborationEvent(
            Guid.NewGuid().ToString("N"),
            DateTimeOffset.UtcNow,
            CollaborationEventKind.AgentHubCommandError,
            NormalizePath(workspacePath),
            message,
            "agenthub",
            "command-error",
            null,
            null,
            "agenthub");
        return AppendAsync(collaborationEvent, cancellationToken);
    }

    private static string FormatPlanStatusCommand(AgentHubPlanStatusCommand command)
    {
        var scope = command.TaskId is null
            ? command.PlanId
            : $"{command.PlanId}/{command.TaskId}";
        return $"[{command.Action} {scope}] {command.Message}";
    }

    private static string FormatTeamStatusCommand(AgentHubTeamStatusCommand command)
    {
        var message = string.Equals(command.Action, "claim_task", StringComparison.Ordinal)
            ? "claimed"
            : string.IsNullOrWhiteSpace(command.Summary) ? "completed" : command.Summary;
        return $"[{command.Action} {command.TeamId}/{command.TaskId}] {message}";
    }

    public async Task<IReadOnlyList<CollaborationEvent>> ListAsync(
        string workspacePath,
        CancellationToken cancellationToken = default)
    {
        var filePath = ResolveFilePath(workspacePath);
        if (!File.Exists(filePath))
        {
            return [];
        }

        var events = new List<CollaborationEvent>();
        var lines = await File.ReadAllLinesAsync(filePath, cancellationToken).ConfigureAwait(false);
        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            try
            {
                var item = JsonSerializer.Deserialize<CollaborationEvent>(line, SerializerOptions);
                if (item is not null)
                {
                    events.Add(item);
                }
            }
            catch (JsonException)
            {
                // Timeline files are append-only; a partial or damaged line must not break workspace loading.
            }
        }

        return events.OrderBy(item => item.Timestamp).ToList();
    }

    private async Task<CollaborationEvent> AppendAsync(
        CollaborationEvent collaborationEvent,
        CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(rootDirectory);
        var filePath = ResolveFilePath(collaborationEvent.WorkspacePath);
        var json = JsonSerializer.Serialize(collaborationEvent, SerializerOptions);
        await File.AppendAllTextAsync(filePath, $"{json}\n", cancellationToken).ConfigureAwait(false);
        return collaborationEvent;
    }

    private string ResolveFilePath(string workspacePath)
    {
        return Path.Combine(rootDirectory, $"{Hash(NormalizePath(workspacePath).ToLowerInvariant())}.jsonl");
    }

    private static string NormalizePath(string workspacePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(workspacePath);
        return workspacePath.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private static string Hash(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
