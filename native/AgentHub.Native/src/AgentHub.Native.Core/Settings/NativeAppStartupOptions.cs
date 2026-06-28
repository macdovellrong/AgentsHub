using AgentHub.Native.Core.Profiles;
using AgentHub.Native.Core.Workspaces;

namespace AgentHub.Native.Core.Settings;

public sealed record NativeAppStartupOptions(
    string? InitialWorkspacePath,
    ShellKind? HostShell,
    string? HookPythonCommand,
    AgentKind? StartupAgentKind,
    AgentStartupMode? StartupMode)
{
    public static NativeAppStartupOptions Empty { get; } = new(null, null, null, null, null);

    public static NativeAppStartupOptions Parse(IReadOnlyList<string> args)
    {
        string? workspacePath = null;
        string? hostShell = null;
        string? hookPythonCommand = null;
        string? startupAgent = null;
        var resume = false;
        for (var index = 0; index < args.Count; index += 1)
        {
            var arg = args[index];
            if (arg.StartsWith("--workspace=", StringComparison.OrdinalIgnoreCase))
            {
                workspacePath = arg["--workspace=".Length..];
                continue;
            }

            if (arg.StartsWith("--shell=", StringComparison.OrdinalIgnoreCase))
            {
                hostShell = arg["--shell=".Length..];
                continue;
            }

            if (arg.StartsWith("--python=", StringComparison.OrdinalIgnoreCase))
            {
                hookPythonCommand = arg["--python=".Length..];
                continue;
            }

            if (arg.StartsWith("--agent=", StringComparison.OrdinalIgnoreCase))
            {
                startupAgent = arg["--agent=".Length..];
                continue;
            }

            if (string.Equals(arg, "--workspace", StringComparison.OrdinalIgnoreCase)
                || string.Equals(arg, "-w", StringComparison.OrdinalIgnoreCase))
            {
                if (index + 1 < args.Count)
                {
                    workspacePath = args[index + 1];
                    index += 1;
                }
            }

            if (string.Equals(arg, "--shell", StringComparison.OrdinalIgnoreCase)
                || string.Equals(arg, "-s", StringComparison.OrdinalIgnoreCase))
            {
                if (index + 1 < args.Count)
                {
                    hostShell = args[index + 1];
                    index += 1;
                }
            }

            if (string.Equals(arg, "--python", StringComparison.OrdinalIgnoreCase))
            {
                if (index + 1 < args.Count)
                {
                    hookPythonCommand = args[index + 1];
                    index += 1;
                }
            }

            if (string.Equals(arg, "--agent", StringComparison.OrdinalIgnoreCase)
                || string.Equals(arg, "-a", StringComparison.OrdinalIgnoreCase))
            {
                if (index + 1 < args.Count)
                {
                    startupAgent = args[index + 1];
                    index += 1;
                }
            }

            if (string.Equals(arg, "--resume", StringComparison.OrdinalIgnoreCase))
            {
                resume = true;
            }
        }

        var agentKind = ParseAgentKind(startupAgent);
        AgentStartupMode? startupMode = agentKind is null
            ? null
            : resume && agentKind == AgentKind.Codex ? AgentStartupMode.Resume : AgentStartupMode.Start;
        return new NativeAppStartupOptions(
            WorkspacePathSelection.NormalizeSelectedPath(workspacePath),
            ParseShellKind(hostShell),
            NormalizeOptional(hookPythonCommand),
            agentKind,
            startupMode);
    }

    private static string? NormalizeOptional(string? value)
    {
        var normalized = value?.Trim();
        return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
    }

    private static ShellKind? ParseShellKind(string? raw)
    {
        return raw?.Trim().ToLowerInvariant() switch
        {
            "powershell" or "pwsh" => ShellKind.PowerShell,
            "cmd" => ShellKind.Cmd,
            _ => null
        };
    }

    private static AgentKind? ParseAgentKind(string? raw)
    {
        return raw?.Trim().ToLowerInvariant() switch
        {
            "codex" => AgentKind.Codex,
            "claude" => AgentKind.Claude,
            "gemini" => AgentKind.Gemini,
            "powershell" or "shell" => AgentKind.PowerShell,
            _ => null
        };
    }
}
