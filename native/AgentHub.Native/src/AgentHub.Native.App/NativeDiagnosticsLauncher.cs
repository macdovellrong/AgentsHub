using System.Diagnostics;
using System.IO;
using System.Text;

namespace AgentHub.Native.App;

public sealed record NativeDiagnosticsRunResult(
    string OutputPath,
    int ExitCode,
    string StandardOutput,
    string StandardError);

public static class NativeDiagnosticsLauncher
{
    private const string DiagnosticsScriptsDirectory = "scripts";
    private const string DiagnosticsScriptName = "collect-native-diagnostics.ps1";

    public static string ResolveScriptPath(
        string appBaseDirectory,
        Func<string, bool>? fileExists = null)
    {
        fileExists ??= File.Exists;
        var baseDirectory = string.IsNullOrWhiteSpace(appBaseDirectory)
            ? AppContext.BaseDirectory
            : appBaseDirectory;

        var directory = new DirectoryInfo(baseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(
                directory.FullName,
                DiagnosticsScriptsDirectory,
                DiagnosticsScriptName);
            if (fileExists(candidate))
            {
                return candidate;
            }

            directory = directory.Parent;
        }

        throw new FileNotFoundException(
            $"AgentHub native diagnostics script was not found from: {baseDirectory}");
    }

    public static string ResolveOutputPath(
        string dataDirectory,
        DateTimeOffset? timestamp = null)
    {
        var resolvedTimestamp = timestamp ?? DateTimeOffset.Now;
        return Path.Combine(
            dataDirectory,
            "diagnostics",
            $"native-diagnostics-{resolvedTimestamp:yyyyMMdd-HHmmss}.md");
    }

    public static string ResolveLatestReportPointerPath(string dataDirectory)
    {
        return Path.Combine(dataDirectory, "diagnostics", "latest-diagnostics.txt");
    }

    public static string WriteLatestReportPointer(
        string dataDirectory,
        NativeDiagnosticsRunResult result,
        DateTimeOffset? timestamp = null)
    {
        ArgumentNullException.ThrowIfNull(result);
        var pointerPath = ResolveLatestReportPointerPath(dataDirectory);
        Directory.CreateDirectory(Path.GetDirectoryName(pointerPath)!);
        var resolvedTimestamp = timestamp ?? DateTimeOffset.Now;
        File.WriteAllText(
            pointerPath,
            string.Join(
                Environment.NewLine,
                [
                    $"timestamp: {resolvedTimestamp:O}",
                    $"exitCode: {result.ExitCode}",
                    $"report: {result.OutputPath}",
                    ""
                ]),
            Encoding.UTF8);
        return pointerPath;
    }

    public static ProcessStartInfo BuildStartInfo(
        string scriptPath,
        string outputPath,
        string pythonCommand,
        string? workspacePath,
        string? agentSelection = null)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = Path.Combine(
                Environment.SystemDirectory,
                "WindowsPowerShell",
                "v1.0",
                "powershell.exe"),
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-ExecutionPolicy");
        startInfo.ArgumentList.Add("Bypass");
        startInfo.ArgumentList.Add("-File");
        startInfo.ArgumentList.Add(scriptPath);
        startInfo.ArgumentList.Add("-Output");
        startInfo.ArgumentList.Add(outputPath);
        startInfo.ArgumentList.Add("-Python");
        startInfo.ArgumentList.Add(pythonCommand);

        if (!string.IsNullOrWhiteSpace(workspacePath))
        {
            startInfo.ArgumentList.Add("-Workspace");
            startInfo.ArgumentList.Add(workspacePath);
        }

        if (!string.IsNullOrWhiteSpace(agentSelection))
        {
            startInfo.ArgumentList.Add("-Agent");
            startInfo.ArgumentList.Add(agentSelection);
        }

        return startInfo;
    }

    public static async Task<NativeDiagnosticsRunResult> RunAsync(
        string dataDirectory,
        string? workspacePath,
        string pythonCommand,
        string agentSelection = "agents",
        CancellationToken cancellationToken = default)
    {
        var scriptPath = ResolveScriptPath(AppContext.BaseDirectory);
        var outputPath = ResolveOutputPath(dataDirectory);
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);

        using var process = new Process
        {
            StartInfo = BuildStartInfo(scriptPath, outputPath, pythonCommand, workspacePath, agentSelection)
        };
        process.Start();
        var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);
        var result = new NativeDiagnosticsRunResult(
            outputPath,
            process.ExitCode,
            await stdoutTask,
            await stderrTask);
        WriteLatestReportPointer(dataDirectory, result);
        return result;
    }
}
