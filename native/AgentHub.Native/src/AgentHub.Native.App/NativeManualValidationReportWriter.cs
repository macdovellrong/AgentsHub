using System.IO;
using System.Text;

namespace AgentHub.Native.App;

public sealed record NativeManualValidationReportRequest(
    string? WorkspacePath,
    string? LatestDiagnosticsPointerPath,
    string? LatestLaptopValidationPointerPath,
    string? HookLogPath,
    IReadOnlyList<string> SessionSummaries);

public static class NativeManualValidationReportWriter
{
    public static string ResolveOutputPath(
        string dataDirectory,
        DateTimeOffset? timestamp = null)
    {
        var resolvedTimestamp = timestamp ?? DateTimeOffset.Now;
        return Path.Combine(
            dataDirectory,
            "diagnostics",
            $"native-manual-validation-{resolvedTimestamp:yyyyMMdd-HHmmss}.md");
    }

    public static string WriteTemplate(
        string dataDirectory,
        NativeManualValidationReportRequest request,
        DateTimeOffset? timestamp = null)
    {
        ArgumentNullException.ThrowIfNull(request);
        var resolvedTimestamp = timestamp ?? DateTimeOffset.Now;
        var outputPath = ResolveOutputPath(dataDirectory, resolvedTimestamp);
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        File.WriteAllText(
            outputPath,
            BuildTemplate(request, resolvedTimestamp),
            Encoding.UTF8);
        return outputPath;
    }

    private static string BuildTemplate(
        NativeManualValidationReportRequest request,
        DateTimeOffset timestamp)
    {
        var lines = new List<string>
        {
            "# AgentHub Native Manual Validation",
            "",
            $"- Generated at: {timestamp:O}",
            $"- Workspace: {FormatOptional(request.WorkspacePath)}",
            $"- Latest diagnostics pointer: {FormatOptional(request.LatestDiagnosticsPointerPath)}",
            $"- Latest laptop validation pointer: {FormatOptional(request.LatestLaptopValidationPointerPath)}",
            $"- Hook log: {FormatOptional(request.HookLogPath)}",
            "",
            "## Sessions At Capture",
            ""
        };

        if (request.SessionSummaries.Count == 0)
        {
            lines.Add("- none");
        }
        else
        {
            foreach (var session in request.SessionSummaries)
            {
                lines.Add($"- {session}");
            }
        }

        lines.AddRange(
        [
            "",
            "## Checklist",
            "",
            "- [ ] validate-native-laptop.ps1 completed and latest-laptop-validation.txt points to a report.",
            "- [ ] Run diagnostics completed and latest-diagnostics.txt points to a report.",
            "- [ ] Scroll Test shows a scrollbar.",
            "- [ ] Mouse wheel scrolls upward in Scroll Test.",
            "- [ ] Touchpad scrolls upward in Scroll Test.",
            "- [ ] Codex resume starts as codex --no-alt-screen resume.",
            "- [ ] Codex resume shows scrollback and can scroll upward.",
            "- [ ] AgentHub input sends text to Codex.",
            "- [ ] Shift+Enter inserts a newline in AgentHub input.",
            "- [ ] Codex hook output appears in Collaboration timeline.",
            "",
            "## Notes",
            "",
            "- Scroll Test result:",
            "- Codex resume result:",
            "- Input result:",
            "- Hook result:",
            "- Remaining issue:"
        ]);

        return string.Join(Environment.NewLine, lines) + Environment.NewLine;
    }

    private static string FormatOptional(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? "unavailable" : value;
    }
}
