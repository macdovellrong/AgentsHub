using System.Diagnostics;

namespace AgentHub.Native.Core.Profiles;

public sealed class AgentStartupPreflightChecker(
    Func<string, string?> commandResolver,
    Func<string, bool> fileExists,
    Func<string, bool> directoryExists,
    Func<string, IReadOnlyList<string>, AgentStartupPythonProbeResult>? hookPythonProbe = null)
{
    private readonly Func<string, IReadOnlyList<string>, AgentStartupPythonProbeResult> pythonProbe =
        hookPythonProbe ?? ProbeHookPython;

    private static readonly string[] RequiredHookScripts =
    [
        "agenthub_hook_common.py",
        "agenthub_codex_stop.py",
        "agenthub_claude_stop.py",
        "agenthub_gemini_after_agent.py"
    ];

    public static AgentStartupPreflightChecker CreateDefault()
    {
        return new AgentStartupPreflightChecker(ResolveCommandOnPath, File.Exists, Directory.Exists);
    }

    public AgentStartupPreflightResult Check(AgentStartupPreflightRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var errors = new List<string>();
        var startupCommand = request.StartupCommand;
        if (!AgentStartupCommandCatalog.IsManagedAgent(startupCommand.AgentKind))
        {
            return new AgentStartupPreflightResult(errors);
        }

        if (!string.IsNullOrWhiteSpace(startupCommand.Command) &&
            ResolveExecutable(startupCommand.Command) is null)
        {
            errors.Add(IsPathLike(startupCommand.Command)
                ? $"Agent CLI was not found: {startupCommand.Command}"
                : $"Agent CLI '{startupCommand.Command}' was not found in PATH.");
        }

        CheckHookScripts(request.HookScriptsDirectory, errors);
        CheckHookPython(request.HookPythonCommand, errors);
        return new AgentStartupPreflightResult(errors);
    }

    private void CheckHookScripts(string? hookScriptsDirectory, List<string> errors)
    {
        var directory = hookScriptsDirectory?.Trim();
        if (string.IsNullOrWhiteSpace(directory))
        {
            errors.Add("AgentHub hook scripts directory was not found.");
            return;
        }

        if (!directoryExists(directory))
        {
            errors.Add($"AgentHub hook scripts directory was not found: {directory}");
            return;
        }

        foreach (var script in RequiredHookScripts)
        {
            var scriptPath = Path.Combine(directory, script);
            if (!fileExists(scriptPath))
            {
                errors.Add($"AgentHub hook script was not found: {scriptPath}");
            }
        }
    }

    private void CheckHookPython(string? hookPythonCommand, List<string> errors)
    {
        if (!TryParsePythonCommand(hookPythonCommand, out var launcher, out var arguments, out var error))
        {
            errors.Add(error);
            return;
        }

        if (ResolveExecutable(launcher) is null)
        {
            errors.Add(IsPathLike(launcher)
                ? $"Hook Python launcher was not found: {launcher}"
                : $"Hook Python launcher '{launcher}' was not found in PATH.");
            return;
        }

        var probeResult = pythonProbe(launcher, arguments);
        if (!probeResult.Succeeded)
        {
            errors.Add($"Hook Python check failed: {probeResult.Error ?? "unknown error"}");
        }
    }

    private string? ResolveExecutable(string command)
    {
        var trimmed = command.Trim().Trim('"');
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return null;
        }

        return IsPathLike(trimmed)
            ? fileExists(trimmed) ? trimmed : null
            : commandResolver(trimmed);
    }

    private static bool TryParsePythonCommand(
        string? command,
        out string launcher,
        out IReadOnlyList<string> arguments,
        out string error)
    {
        var trimmed = command?.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            launcher = "";
            arguments = [];
            error = "Hook Python command is required for managed agent hooks.";
            return false;
        }

        if (trimmed.StartsWith('"'))
        {
            var endQuote = trimmed.IndexOf('"', 1);
            if (endQuote < 0)
            {
                launcher = "";
                arguments = [];
                error = $"Invalid Hook Python command, missing closing quote: {command}";
                return false;
            }

            launcher = trimmed[1..endQuote];
            arguments = SplitArguments(trimmed[(endQuote + 1)..].Trim());
            error = "";
            return true;
        }

        var exeIndex = trimmed.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
        if (exeIndex >= 0)
        {
            launcher = trimmed[..(exeIndex + ".exe".Length)];
            arguments = SplitArguments(trimmed[(exeIndex + ".exe".Length)..].Trim());
            error = "";
            return true;
        }

        var firstSpace = trimmed.IndexOf(' ');
        launcher = firstSpace < 0 ? trimmed : trimmed[..firstSpace];
        arguments = firstSpace < 0 ? [] : SplitArguments(trimmed[(firstSpace + 1)..].Trim());
        error = "";
        return true;
    }

    private static IReadOnlyList<string> SplitArguments(string raw)
    {
        return string.IsNullOrWhiteSpace(raw)
            ? []
            : raw.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }

    private static AgentStartupPythonProbeResult ProbeHookPython(string launcher, IReadOnlyList<string> arguments)
    {
        try
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = launcher,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                }
            };
            foreach (var argument in arguments)
            {
                process.StartInfo.ArgumentList.Add(argument);
            }

            process.StartInfo.ArgumentList.Add("-c");
            process.StartInfo.ArgumentList.Add("import json, pathlib, sys, urllib.request; print(sys.executable)");
            process.Start();
            if (!process.WaitForExit(milliseconds: 5000))
            {
                process.Kill(entireProcessTree: true);
                return AgentStartupPythonProbeResult.Failure("timed out after 5 seconds");
            }

            var stderr = process.StandardError.ReadToEnd().Trim();
            var stdout = process.StandardOutput.ReadToEnd().Trim();
            if (process.ExitCode == 0)
            {
                return AgentStartupPythonProbeResult.Success();
            }

            var details = string.IsNullOrWhiteSpace(stderr) ? stdout : stderr;
            return AgentStartupPythonProbeResult.Failure(
                string.IsNullOrWhiteSpace(details)
                    ? $"exit code {process.ExitCode}"
                    : $"exit code {process.ExitCode}: {details}");
        }
        catch (Exception ex)
        {
            return AgentStartupPythonProbeResult.Failure(ex.Message);
        }
    }

    private static bool IsPathLike(string value)
    {
        return value.Contains(':', StringComparison.Ordinal) ||
               value.Contains('\\', StringComparison.Ordinal) ||
               value.Contains('/', StringComparison.Ordinal);
    }

    private static string? ResolveCommandOnPath(string command)
    {
        var path = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrWhiteSpace(path))
        {
            return null;
        }

        var candidates = CandidateCommandNames(command);
        foreach (var directory in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            foreach (var candidate in candidates)
            {
                var fullPath = Path.Combine(directory, candidate);
                if (File.Exists(fullPath))
                {
                    return fullPath;
                }
            }
        }

        return null;
    }

    private static IReadOnlyList<string> CandidateCommandNames(string command)
    {
        if (Path.HasExtension(command))
        {
            return [command];
        }

        var pathExtensions = Environment.GetEnvironmentVariable("PATHEXT")
            ?.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (pathExtensions is null || pathExtensions.Length == 0)
        {
            pathExtensions = [".exe", ".cmd", ".bat", ".com"];
        }

        return pathExtensions
            .Select(extension => $"{command}{extension}")
            .Prepend(command)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }
}
