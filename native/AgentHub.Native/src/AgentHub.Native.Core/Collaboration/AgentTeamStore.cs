using System.Text.Json;

namespace AgentHub.Native.Core.Collaboration;

public sealed class AgentTeamStore
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    private static readonly JsonSerializerOptions TeamSerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    public async Task<AgentTeam> EnsureTeamAsync(
        string workspacePath,
        AgentTeamRequest request,
        CancellationToken cancellationToken = default)
    {
        var existing = await GetTeamAsync(workspacePath, request.Id, cancellationToken).ConfigureAwait(false);
        if (existing is not null)
        {
            return existing;
        }

        var now = DateTimeOffset.UtcNow;
        var team = new AgentTeam(request.Id, request.Name, request.MemberProfileIds, now, now);
        Directory.CreateDirectory(TeamPath(workspacePath, request.Id));
        var json = JsonSerializer.Serialize(team, TeamSerializerOptions);
        await File.WriteAllTextAsync(TeamConfigPath(workspacePath, request.Id), $"{json}\n", cancellationToken).ConfigureAwait(false);
        return team;
    }

    public async Task<AgentTeam?> GetTeamAsync(
        string workspacePath,
        string teamId,
        CancellationToken cancellationToken = default)
    {
        var filePath = TeamConfigPath(workspacePath, teamId);
        if (!File.Exists(filePath))
        {
            return null;
        }

        try
        {
            var json = await File.ReadAllTextAsync(filePath, cancellationToken).ConfigureAwait(false);
            return JsonSerializer.Deserialize<AgentTeam>(json, SerializerOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public async Task<AgentTeamMailboxMessage> AppendMailboxAsync(
        string workspacePath,
        AgentTeamMailboxRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureTeamAsync(
            workspacePath,
            new AgentTeamRequest(
                request.TeamId,
                string.Equals(request.TeamId, "default", StringComparison.Ordinal) ? "Default Team" : request.TeamId,
                []),
            cancellationToken).ConfigureAwait(false);

        var now = DateTimeOffset.UtcNow;
        var message = new AgentTeamMailboxMessage(
            Guid.NewGuid().ToString("N"),
            request.TeamId,
            request.Action,
            request.FromProfileId,
            request.ToProfileId,
            request.Message,
            request.TaskId,
            request.ConversationId,
            request.Status,
            request.SessionId,
            request.Error,
            now,
            now,
            request.PlanId);
        Directory.CreateDirectory(TeamPath(workspacePath, request.TeamId));
        var json = JsonSerializer.Serialize(message, SerializerOptions);
        await File.AppendAllTextAsync(MailboxPath(workspacePath, request.TeamId), $"{json}\n", cancellationToken).ConfigureAwait(false);
        return message;
    }

    public async Task<IReadOnlyList<AgentTeamMailboxMessage>> ListMailboxAsync(
        string workspacePath,
        string teamId,
        CancellationToken cancellationToken = default)
    {
        var filePath = MailboxPath(workspacePath, teamId);
        if (!File.Exists(filePath))
        {
            return [];
        }

        var messages = new List<AgentTeamMailboxMessage>();
        var lines = await File.ReadAllLinesAsync(filePath, cancellationToken).ConfigureAwait(false);
        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            try
            {
                var message = JsonSerializer.Deserialize<AgentTeamMailboxMessage>(line, SerializerOptions);
                if (message is not null)
                {
                    messages.Add(message);
                }
            }
            catch (JsonException)
            {
                // Mailbox files are append-only; ignore partial or damaged lines.
            }
        }

        return messages;
    }

    private static string TeamPath(string workspacePath, string teamId)
    {
        return Path.Combine(workspacePath, ".agenthub", "teams", SanitizeTeamId(teamId));
    }

    private static string TeamConfigPath(string workspacePath, string teamId)
    {
        return Path.Combine(TeamPath(workspacePath, teamId), "config.json");
    }

    private static string MailboxPath(string workspacePath, string teamId)
    {
        return Path.Combine(TeamPath(workspacePath, teamId), "mailbox.jsonl");
    }

    private static string SanitizeTeamId(string teamId)
    {
        var sanitized = new string(teamId.Select(character =>
            char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '-'
                ? character
                : '_').ToArray());
        return string.IsNullOrWhiteSpace(sanitized) ? "default" : sanitized;
    }
}
