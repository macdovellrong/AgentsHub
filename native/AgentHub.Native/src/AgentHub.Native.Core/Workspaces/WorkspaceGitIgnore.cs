namespace AgentHub.Native.Core.Workspaces;

public static class WorkspaceGitIgnore
{
    private static readonly string[] RuntimeDirectories = [".agenthub", ".codex", ".claude", ".gemini"];

    public static async Task<bool> EnsureAsync(
        string workspacePath,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(workspacePath);
        var gitIgnorePath = Path.Combine(workspacePath, ".gitignore");
        var current = File.Exists(gitIgnorePath)
            ? await File.ReadAllTextAsync(gitIgnorePath, cancellationToken).ConfigureAwait(false)
            : "";
        var next = Merge(current);
        if (next == current)
        {
            return false;
        }

        Directory.CreateDirectory(workspacePath);
        await File.WriteAllTextAsync(gitIgnorePath, next, cancellationToken).ConfigureAwait(false);
        return true;
    }

    public static string Merge(string raw)
    {
        var existing = raw
            .TrimStart('\uFEFF')
            .Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n')
            .Split('\n')
            .Select(NormalizePattern)
            .OfType<string>()
            .ToHashSet(StringComparer.Ordinal);
        var missing = RuntimeDirectories
            .Where(directory => !existing.Contains(directory))
            .Select(directory => $"{directory}/")
            .ToArray();

        if (missing.Length == 0)
        {
            return raw;
        }

        var normalized = raw
            .Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n')
            .TrimEnd();
        var prefix = string.IsNullOrEmpty(normalized) ? "" : $"{normalized}\n";
        return $"{prefix}{string.Join('\n', missing)}\n";
    }

    private static string? NormalizePattern(string line)
    {
        var trimmed = line.Trim();
        if (string.IsNullOrEmpty(trimmed) || trimmed.StartsWith('#') || trimmed.StartsWith('!'))
        {
            return null;
        }

        var pattern = trimmed;
        var commentIndex = pattern.IndexOf(" #", StringComparison.Ordinal);
        if (commentIndex >= 0)
        {
            pattern = pattern[..commentIndex].TrimEnd();
        }

        pattern = pattern.Replace('\\', '/');
        if (pattern.StartsWith("./", StringComparison.Ordinal))
        {
            pattern = pattern[2..];
        }

        pattern = pattern.TrimStart('/');
        pattern = pattern.TrimEnd('/');
        if (pattern.EndsWith("/**", StringComparison.Ordinal))
        {
            pattern = pattern[..^3].TrimEnd('/');
        }
        else if (pattern.EndsWith("/*", StringComparison.Ordinal))
        {
            pattern = pattern[..^2].TrimEnd('/');
        }

        if (!pattern.StartsWith('.'))
        {
            pattern = $".{pattern}";
        }

        return RuntimeDirectories.Contains(pattern, StringComparer.Ordinal) ? pattern : null;
    }
}
