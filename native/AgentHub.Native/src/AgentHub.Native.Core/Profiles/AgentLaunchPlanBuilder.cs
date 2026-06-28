namespace AgentHub.Native.Core.Profiles;

public static class AgentLaunchPlanBuilder
{
    public static AgentLaunchPlan Build(AgentLaunchRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (string.IsNullOrWhiteSpace(request.WorkingDirectory))
        {
            throw new ArgumentException("Working directory is required.", nameof(request));
        }

        return request.ShellKind switch
        {
            ShellKind.PowerShell => BuildPowerShellPlan(request),
            ShellKind.Cmd => BuildCmdPlan(request),
            _ => throw new ArgumentOutOfRangeException(nameof(request), request.ShellKind, "Unsupported shell kind.")
        };
    }

    private static AgentLaunchPlan BuildPowerShellPlan(AgentLaunchRequest request)
    {
        var commands = new List<string>();
        commands.AddRange(BuildPowerShellEnvironmentAssignments(request.EnvironmentVariables));
        commands.Add($"Set-Location -LiteralPath {QuotePowerShell(request.WorkingDirectory)}");
        if (!string.IsNullOrWhiteSpace(request.Command))
        {
            commands.Add(BuildPowerShellInvocation(request.Command, request.Arguments));
        }

        var commandText = string.Join("; ", commands);

        return new AgentLaunchPlan(
            request.AgentKind,
            request.ShellKind,
            request.WorkingDirectory,
            Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe"),
            ["-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", commandText],
            commandText);
    }

    private static IEnumerable<string> BuildPowerShellEnvironmentAssignments(
        IReadOnlyDictionary<string, string>? environmentVariables)
    {
        if (environmentVariables is null)
        {
            yield break;
        }

        foreach (var item in environmentVariables.OrderBy(item => item.Key, StringComparer.Ordinal))
        {
            yield return $"$env:{item.Key} = {QuotePowerShell(item.Value)}";
        }
    }

    private static AgentLaunchPlan BuildCmdPlan(AgentLaunchRequest request)
    {
        var commandText = $"cd /d {QuoteCmd(request.WorkingDirectory)}";
        if (!string.Equals(request.Command, "cmd.exe", StringComparison.OrdinalIgnoreCase))
        {
            commandText = $"{commandText} && {QuoteCmd(request.Command)}";
            if (request.Arguments.Count > 0)
            {
                commandText = $"{commandText} {string.Join(" ", request.Arguments.Select(QuoteCmd))}";
            }
        }

        return new AgentLaunchPlan(
            request.AgentKind,
            request.ShellKind,
            request.WorkingDirectory,
            Path.Combine(Environment.SystemDirectory, "cmd.exe"),
            ["/K", commandText],
            commandText);
    }

    private static string BuildPowerShellInvocation(string command, IReadOnlyList<string> args)
    {
        var parts = new List<string> { $"& {QuotePowerShell(command)}" };
        parts.AddRange(args.Select(QuotePowerShell));
        return string.Join(" ", parts);
    }

    private static string QuotePowerShell(string value)
    {
        return $"'{value.Replace("'", "''", StringComparison.Ordinal)}'";
    }

    private static string QuoteCmd(string value)
    {
        return $"\"{value.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";
    }
}
