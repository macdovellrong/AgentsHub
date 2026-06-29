using System.Text.Json;
using System.Text.RegularExpressions;

namespace AgentHub.Native.Core.Collaboration;

public sealed record PairConversationArtifactInput(
    string ConversationId,
    string Topic,
    IReadOnlyList<string> ParticipantProfileIds,
    int? MaxSteps);

public sealed record PairConversationArtifactPaths(
    string ConversationRoot,
    string BriefPath,
    string MemoryPath,
    string StatePath,
    string TurnsPath);

public sealed record ValidatedArtifactPath(
    string RelativePath,
    string AbsolutePath);

public sealed record WriteTurnArtifactInput(
    string ConversationId,
    int Step,
    string ProfileId,
    string Content);

public sealed class AgentConversationArtifactStore
{
    private static readonly Regex SafeConversationIdPattern = new("^[a-zA-Z0-9_-]+$", RegexOptions.CultureInvariant);

    public async Task<PairConversationArtifactPaths> InitializePairConversationAsync(
        string workspacePath,
        PairConversationArtifactInput input,
        CancellationToken cancellationToken = default)
    {
        var conversationId = ValidateConversationId(input.ConversationId);
        var safeInput = input with { ConversationId = conversationId };
        var paths = Paths(conversationId);

        Directory.CreateDirectory(Path.Combine(workspacePath, paths.TurnsPath));
        await File.WriteAllTextAsync(
            Path.Combine(workspacePath, paths.BriefPath),
            RenderBrief(safeInput),
            cancellationToken).ConfigureAwait(false);
        await File.WriteAllTextAsync(
            Path.Combine(workspacePath, paths.MemoryPath),
            RenderInitialMemory(),
            cancellationToken).ConfigureAwait(false);
        await File.WriteAllTextAsync(
            Path.Combine(workspacePath, paths.StatePath),
            RenderInitialState(safeInput),
            cancellationToken).ConfigureAwait(false);

        return paths;
    }

    public PairConversationArtifactPaths Paths(string conversationId)
    {
        var safeConversationId = ValidateConversationId(conversationId);
        var conversationRoot = $".agenthub/conversations/{safeConversationId}";
        return new PairConversationArtifactPaths(
            conversationRoot,
            $"{conversationRoot}/brief.md",
            $"{conversationRoot}/memory.md",
            $"{conversationRoot}/state.json",
            $"{conversationRoot}/turns");
    }

    public string TurnArtifactPath(string conversationId, int step, string profileId)
    {
        var safeConversationId = ValidateConversationId(conversationId);
        var sequence = Math.Max(0, step).ToString("0000", System.Globalization.CultureInfo.InvariantCulture);
        var safeProfileId = Regex.Replace(profileId, "[^a-zA-Z0-9_-]+", "-").Trim('-');
        if (string.IsNullOrWhiteSpace(safeProfileId))
        {
            safeProfileId = "agent";
        }

        return $".agenthub/conversations/{safeConversationId}/turns/{sequence}-{safeProfileId}.md";
    }

    public async Task<ValidatedArtifactPath> WriteTurnArtifactAsync(
        string workspacePath,
        WriteTurnArtifactInput input,
        CancellationToken cancellationToken = default)
    {
        var relativePath = TurnArtifactPath(input.ConversationId, input.Step, input.ProfileId);
        var absolutePath = Path.Combine(workspacePath, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(absolutePath)!);
        var content = input.Content.EndsWith('\n') ? input.Content : input.Content + "\n";
        await File.WriteAllTextAsync(absolutePath, content, cancellationToken).ConfigureAwait(false);
        return await ValidateTurnArtifactPathAsync(
            workspacePath,
            input.ConversationId,
            relativePath,
            cancellationToken).ConfigureAwait(false);
    }

    public async Task<ValidatedArtifactPath> ValidateTurnArtifactPathAsync(
        string workspacePath,
        string conversationId,
        string artifactPath,
        CancellationToken cancellationToken = default)
    {
        var safeConversationId = ValidateConversationId(conversationId);
        var normalized = artifactPath.Replace('\\', '/');
        if (Path.IsPathRooted(normalized) || normalized.Split('/').Contains("..", StringComparer.Ordinal))
        {
            throw new InvalidOperationException("Unsafe artifact path.");
        }

        var turnsPrefix = $".agenthub/conversations/{safeConversationId}/turns/";
        if (!normalized.StartsWith(turnsPrefix, StringComparison.Ordinal) ||
            !normalized.EndsWith(".md", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Artifact path must stay inside the conversation turns directory.");
        }

        var absolutePath = Path.GetFullPath(Path.Combine(workspacePath, normalized));
        var turnsRoot = Path.GetFullPath(Path.Combine(
            workspacePath,
            ".agenthub",
            "conversations",
            safeConversationId,
            "turns"));
        var relativeToTurns = Path.GetRelativePath(turnsRoot, absolutePath);
        if (relativeToTurns.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(relativeToTurns))
        {
            throw new InvalidOperationException("Artifact path must stay inside the conversation turns directory.");
        }

        await using var stream = File.OpenRead(absolutePath);
        if (stream.Length >= 0)
        {
            return new ValidatedArtifactPath(normalized, absolutePath);
        }

        throw new FileNotFoundException("Artifact file does not exist.", absolutePath);
    }

    private static string RenderBrief(PairConversationArtifactInput input)
    {
        var lines = new List<string>
        {
            "# Negotiation Brief",
            "",
            input.Topic,
            "",
            "## Participants",
            ""
        };
        lines.AddRange(input.ParticipantProfileIds.Select(profileId => $"- {profileId}"));
        lines.Add("");
        lines.Add($"Max steps: {input.MaxSteps?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "unlimited"}");
        lines.Add("");
        return string.Join("\n", lines);
    }

    private static string RenderInitialMemory()
    {
        return string.Join(
            "\n",
            [
                "# Conversation Memory",
                "",
                "## Current Consensus",
                "",
                "## Key Constraints",
                "",
                "## Open Questions",
                "",
                "## Next Focus",
                ""
            ]);
    }

    private static string RenderInitialState(PairConversationArtifactInput input)
    {
        var state = new
        {
            conversationId = input.ConversationId,
            participantProfileIds = input.ParticipantProfileIds,
            maxSteps = input.MaxSteps,
            latestProposalVersion = (double?)null,
            latestArtifactPath = (string?)null,
            status = "running"
        };
        return JsonSerializer.Serialize(state, new JsonSerializerOptions { WriteIndented = true }) + "\n";
    }

    private static string ValidateConversationId(string conversationId)
    {
        if (!SafeConversationIdPattern.IsMatch(conversationId))
        {
            throw new InvalidOperationException("Unsafe conversation id.");
        }

        return conversationId;
    }
}
