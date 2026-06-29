using System.IO;

namespace AgentHub.Native.App;

public static class NativeDiagnosticsPaths
{
    public static string ResolveDataDirectory(
        string? localApplicationData = null,
        string? fallbackBaseDirectory = null)
    {
        var appData = localApplicationData ?? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return string.IsNullOrWhiteSpace(appData)
            ? Path.Combine(fallbackBaseDirectory ?? AppContext.BaseDirectory, ".agenthub-native")
            : Path.Combine(appData, "AgentHub", "Native");
    }

    public static string ResolveHookLogPath(string dataDirectory)
    {
        return Path.Combine(dataDirectory, "hooks.jsonl");
    }
}
