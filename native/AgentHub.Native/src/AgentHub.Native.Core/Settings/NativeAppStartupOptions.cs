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
            if (TryReadInlineValue(arg, "--workspace=", "-workspace=", out var inlineWorkspacePath))
            {
                workspacePath = inlineWorkspacePath;
                continue;
            }

            if (TryReadInlineValue(arg, "--shell=", "-shell=", out var inlineHostShell))
            {
                hostShell = inlineHostShell;
                continue;
            }

            if (TryReadInlineValue(arg, "--python=", "-python=", out var inlineHookPythonCommand))
            {
                hookPythonCommand = inlineHookPythonCommand;
                continue;
            }

            if (TryReadInlineValue(arg, "--agent=", "-agent=", out var inlineAgent))
            {
                startupAgents.Add(inlineAgent);
                continue;
            }

            if (IsOption(arg, "--workspace", "-workspace", "-w"))
            {
                if (index + 1 < args.Count)
                {
                    workspacePath = args[index + 1];
                    index += 1;
                }
            }

            if (IsOption(arg, "--shell", "-shell", "-s"))
            {
                if (index + 1 < args.Count)
                {
                    hostShell = args[index + 1];
                    index += 1;
                }
            }

            if (IsOption(arg, "--python", "-python"))
            {
                if (index + 1 < args.Count)
                {
                    hookPythonCommand = args[index + 1];
                    index += 1;
                }
            }

            if (IsOption(arg, "--agent", "-agent", "-a"))
            {
                if (index + 1 < args.Count)
                {
                    startupAgents.Add(args[index + 1]);
                    index += 1;
                }
            }

            if (IsOption(arg, "--resume", "-resume"))
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

    private static bool IsOption(string arg, params string[] names)
    {
        return names.Any(name => string.Equals(arg, name, StringComparison.OrdinalIgnoreCase));
    }

    private static bool TryReadInlineValue(string arg, string longPrefix, string powershellPrefix, out string value)
    {
        if (arg.StartsWith(longPrefix, StringComparison.OrdinalIgnoreCase))
        {
            value = arg[longPrefix.Length..];
            return true;
        }

        if (arg.StartsWith(powershellPrefix, StringComparison.OrdinalIgnoreCase))
        {
            value = arg[powershellPrefix.Length..];
            return true;
        }

        value = "";
        return false;
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
                    "powershell" or "shell" => ShellKind.PowerShell,
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
