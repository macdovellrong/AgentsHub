using System.IO;
using System.Text;

namespace AgentHub.Native.App.Tests;

public sealed class NativeDiagnosticsLauncherTests
{
    [Fact]
    public void Resolves_published_diagnostics_script_from_app_base()
    {
        var root = CreateTempDirectory();
        try
        {
            var scriptPath = Path.Combine(root, "scripts", "collect-native-diagnostics.ps1");
            Directory.CreateDirectory(Path.GetDirectoryName(scriptPath)!);
            File.WriteAllText(scriptPath, "", Encoding.UTF8);

            var resolved = NativeDiagnosticsLauncher.ResolveScriptPath(
                root,
                File.Exists);

            Assert.Equal(scriptPath, resolved);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Resolves_source_diagnostics_script_by_walking_parent_directories()
    {
        var root = CreateTempDirectory();
        try
        {
            var scriptPath = Path.Combine(root, "scripts", "collect-native-diagnostics.ps1");
            var appBase = Path.Combine(root, "native", "AgentHub.Native", "bin", "Debug");
            Directory.CreateDirectory(Path.GetDirectoryName(scriptPath)!);
            Directory.CreateDirectory(appBase);
            File.WriteAllText(scriptPath, "", Encoding.UTF8);

            var resolved = NativeDiagnosticsLauncher.ResolveScriptPath(
                appBase,
                File.Exists);

            Assert.Equal(scriptPath, resolved);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Builds_process_start_info_with_output_python_and_workspace()
    {
        var outputPath = NativeDiagnosticsLauncher.ResolveOutputPath(
            @"C:\Users\saber\AppData\Local\AgentHub\Native",
            new DateTimeOffset(2026, 6, 29, 15, 4, 5, TimeSpan.Zero));

        var startInfo = NativeDiagnosticsLauncher.BuildStartInfo(
            @"C:\AgentHub\scripts\collect-native-diagnostics.ps1",
            outputPath,
            "py -3.11",
            @"V:\OrderManager");

        Assert.EndsWith(@"\powershell.exe", startInfo.FileName, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(
            [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                @"C:\AgentHub\scripts\collect-native-diagnostics.ps1",
                "-Output",
                @"C:\Users\saber\AppData\Local\AgentHub\Native\diagnostics\native-diagnostics-20260629-150405.md",
                "-Python",
                "py -3.11",
                "-Workspace",
                @"V:\OrderManager"
            ],
            startInfo.ArgumentList.ToArray());
        Assert.False(startInfo.UseShellExecute);
        Assert.True(startInfo.RedirectStandardOutput);
        Assert.True(startInfo.RedirectStandardError);
    }

    private static string CreateTempDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), $"agenthub-native-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        return path;
    }
}
