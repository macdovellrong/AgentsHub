using AgentHub.Native.Core.Profiles;
using AgentHub.Native.Core.Workspaces;

namespace AgentHub.Native.Core.Settings;

public sealed record NativeAppStartupOptions(
    string? InitialWorkspacePath,
    ShellKind? HostShell,
    string? HookPythonCommand,
    IReadOnlyList<NativeAppStartupAgent> StartupAgents,
    AgentKind? StartupAgentKind,
    AgentStartupMode? StartupMode)
{
    public static NativeAppStartupOptions Empty { get; } = new(null, null, null, [], null, null);

    public static NativeAppStartupOptions Parse(IReadOnlyList<string> args)
    {
        string? workspacePath = null;
        string? hostShell = null;
        string? hookPythonCommand = null;
        var startupAgents = new List<string>();
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
                startupAgents.Add(arg["--agent=".Length..]);
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
                    startupAgents.Add(args[index + 1]);
                    index += 1;
                }
            }

            if (string.Equals(arg, "--resume", StringComparison.OrdinalIgnoreCase))
            {
                resume = true;
            }
        }

        var parsedAgents = ParseStartupAgents(startupAgents, resume);
        var parsedHostShell = ParseShellKind(hostShell) ?? ParseHostShellFromStartupAgents(startupAgents);
        var firstAgent = parsedAgents.FirstOrDefault();
        return new NativeAppStartupOptions(
            WorkspacePathSelection.NormalizeSelectedPath(workspacePath),
            parsedHostShell,
            NormalizeOptional(hookPythonCommand),
            parsedAgents,
            firstAgent?.AgentKind,
            firstAgent?.Mode);
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
            "powershell" or "cmd" or "shell" => AgentKind.PowerShell,
            _ => null
        };
    }

    private static ShellKind? ParseHostShellFromStartupAgents(IReadOnlyList<string> rawAgents)
    {
        foreach (var rawAgent in rawAgents)
        {
            foreach (var token in rawAgent.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var shellKind = token.ToLowerInvariant() switch
                {
                    "powershell" => ShellKind.PowerShell,
                    "cmd" => ShellKind.Cmd,
                    _ => (ShellKind?)null
                };
                if (shellKind is not null)
                {
                    return shellKind;
                }
            }
        }

        return null;
    }

    private static IReadOnlyList<NativeAppStartupAgent> ParseStartupAgents(
        IReadOnlyList<string> rawAgents,
        bool resume)
    {
        var agents = new List<NativeAppStartupAgent>();
        foreach (var rawAgent in rawAgents)
        {
            foreach (var token in rawAgent.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var agentKind = ParseAgentKind(token);
                if (agentKind is null)
                {
                    continue;
                }

                var mode = resume && agentKind == AgentKind.Codex
                    ? AgentStartupMode.Resume
                    : AgentStartupMode.Start;
                agents.Add(new NativeAppStartupAgent(agentKind.Value, mode));
            }
        }

        return agents;
    }
}
