using System.Text.Json;

namespace AgentHub.Native.Core.Workspaces;

public sealed class WorkspaceStore(string storePath)
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        WriteIndented = true
    };

    public async Task<IReadOnlyList<WorkspaceEntry>> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(storePath))
        {
            return [];
        }

        var raw = await File.ReadAllTextAsync(storePath, cancellationToken).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<WorkspaceEntry>>(raw, SerializerOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    public async Task<WorkspaceEntry> AddOrUpdateAsync(string workspacePath, CancellationToken cancellationToken = default)
    {
        var normalizedPath = NormalizePath(workspacePath);
        var entries = (await LoadAsync(cancellationToken).ConfigureAwait(false)).ToList();
        var existing = entries.FirstOrDefault(existing => PathsEqual(existing.Path, normalizedPath));
        var entry = existing ?? new WorkspaceEntry(normalizedPath, ResolveName(normalizedPath));
        entries.RemoveAll(existing => PathsEqual(existing.Path, entry.Path));
        entries.Insert(0, entry);
        await SaveAsync(entries, cancellationToken).ConfigureAwait(false);
        if (Directory.Exists(normalizedPath))
        {
            await WorkspaceGitIgnore.EnsureAsync(normalizedPath, cancellationToken).ConfigureAwait(false);
        }

        return entry;
    }

    public async Task RemoveAsync(string workspacePath, CancellationToken cancellationToken = default)
    {
        var normalizedPath = NormalizePath(workspacePath);
        var entries = (await LoadAsync(cancellationToken).ConfigureAwait(false)).ToList();
        entries.RemoveAll(existing => PathsEqual(existing.Path, normalizedPath));
        await SaveAsync(entries, cancellationToken).ConfigureAwait(false);
    }

    private async Task SaveAsync(IReadOnlyList<WorkspaceEntry> entries, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(storePath)!);
        var json = JsonSerializer.Serialize(entries, SerializerOptions);
        await File.WriteAllTextAsync(storePath, $"{json}\n", cancellationToken).ConfigureAwait(false);
    }

    private static bool PathsEqual(string left, string right)
    {
        return string.Equals(NormalizePath(left), NormalizePath(right), StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizePath(string workspacePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(workspacePath);
        return workspacePath.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private static string ResolveName(string workspacePath)
    {
        return Path.GetFileName(workspacePath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
    }
}
