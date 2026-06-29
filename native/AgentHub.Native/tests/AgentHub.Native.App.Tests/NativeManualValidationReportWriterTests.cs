using System.IO;
using System.Text;

namespace AgentHub.Native.App.Tests;

public sealed class NativeManualValidationReportWriterTests
{
    [Fact]
    public void Resolves_output_path_inside_diagnostics_directory()
    {
        var outputPath = NativeManualValidationReportWriter.ResolveOutputPath(
            @"C:\AgentHub\Native",
            new DateTimeOffset(2026, 6, 29, 22, 40, 5, TimeSpan.Zero));

        Assert.Equal(
            @"C:\AgentHub\Native\diagnostics\native-manual-validation-20260629-224005.md",
            outputPath);
    }

    [Fact]
    public void Writes_manual_validation_template_with_context_and_checklist()
    {
        var root = CreateTempDirectory();
        try
        {
            var outputPath = NativeManualValidationReportWriter.WriteTemplate(
                root,
                new NativeManualValidationReportRequest(
                    WorkspacePath: @"V:\OrderManager",
                    LatestDiagnosticsPointerPath: Path.Combine(root, "diagnostics", "latest-diagnostics.txt"),
                    LatestLaptopValidationPointerPath: Path.Combine(root, "diagnostics", "latest-laptop-validation.txt"),
                    HookLogPath: Path.Combine(root, "hooks.jsonl"),
                    SessionSummaries:
                    [
                        "codex-1 | profile=codex | workspace=V:\\OrderManager",
                        "scrolltest-1 | profile=scrolltest | workspace=V:\\OrderManager"
                    ]),
                new DateTimeOffset(2026, 6, 29, 22, 41, 6, TimeSpan.Zero));

            var content = File.ReadAllText(outputPath, Encoding.UTF8);
            Assert.Contains("# AgentHub Native Manual Validation", content, StringComparison.Ordinal);
            Assert.Contains("Generated at: 2026-06-29T22:41:06.0000000+00:00", content, StringComparison.Ordinal);
            Assert.Contains("Workspace: V:\\OrderManager", content, StringComparison.Ordinal);
            Assert.Contains("latest-diagnostics.txt", content, StringComparison.Ordinal);
            Assert.Contains("latest-laptop-validation.txt", content, StringComparison.Ordinal);
            Assert.Contains("hooks.jsonl", content, StringComparison.Ordinal);
            Assert.Contains("codex-1 | profile=codex", content, StringComparison.Ordinal);
            Assert.Contains("scrolltest-1 | profile=scrolltest", content, StringComparison.Ordinal);
            Assert.Contains("- [ ] Scroll Test shows a scrollbar.", content, StringComparison.Ordinal);
            Assert.Contains("- [ ] Codex resume shows scrollback and can scroll upward.", content, StringComparison.Ordinal);
            Assert.Contains("- [ ] AgentHub input sends text to Codex.", content, StringComparison.Ordinal);
            Assert.Contains("- [ ] Shift+Enter inserts a newline in AgentHub input.", content, StringComparison.Ordinal);
            Assert.Contains("- [ ] Codex hook output appears in Collaboration timeline.", content, StringComparison.Ordinal);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private static string CreateTempDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), $"agenthub-native-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        return path;
    }
}
