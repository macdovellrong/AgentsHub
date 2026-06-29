namespace AgentHub.Native.Core.Profiles;

public static class AgentStartupCommandCatalog
{
    private const string CodexNoAltScreenArgument = "--no-alt-screen";
    private const int ScrollSmokeLineCount = 240;

    public static IReadOnlyList<AgentStartupCommand> BuildManagedAgentStartCommands()
    {
        return
        [
            Build(AgentKind.Codex, AgentStartupMode.Start),
            Build(AgentKind.Claude, AgentStartupMode.Start),
            Build(AgentKind.Gemini, AgentStartupMode.Start)
        ];
    }

    public static IReadOnlyList<AgentStartupCommand> BuildManagedAgentResumeCommands()
    {
        return
        [
            Build(AgentKind.Codex, AgentStartupMode.Resume),
            Build(AgentKind.Claude, AgentStartupMode.Start),
            Build(AgentKind.Gemini, AgentStartupMode.Start)
        ];
    }

    public static bool IsManagedAgent(AgentKind agentKind)
    {
        return agentKind is AgentKind.Codex or AgentKind.Claude or AgentKind.Gemini;
    }

    public static AgentStartupCommand Build(AgentKind agentKind, AgentStartupMode mode)
    {
        return (agentKind, mode) switch
        {
            (AgentKind.PowerShell, AgentStartupMode.Start) => new AgentStartupCommand(agentKind, "", []),
            (AgentKind.Codex, AgentStartupMode.Start) => new AgentStartupCommand(agentKind, "codex", [CodexNoAltScreenArgument]),
            (AgentKind.Codex, AgentStartupMode.Resume) => new AgentStartupCommand(agentKind, "codex", [CodexNoAltScreenArgument, "resume"]),
            (AgentKind.Claude, AgentStartupMode.Start) => new AgentStartupCommand(agentKind, "claude", []),
            (AgentKind.Gemini, AgentStartupMode.Start) => new AgentStartupCommand(agentKind, "gemini", []),
            (AgentKind.ScrollTest, AgentStartupMode.Start) => BuildScrollTestCommand(agentKind),
            _ => throw new NotSupportedException($"{mode} is not configured for {agentKind}.")
        };
    }

    private static AgentStartupCommand BuildScrollTestCommand(AgentKind agentKind)
    {
        var script =
            "$host.UI.RawUI.WindowTitle = 'AgentHub Scroll Test'; " +
            $"1..{ScrollSmokeLineCount} | ForEach-Object {{ 'AgentHub scroll smoke line {{0:000}}' -f $_ }}; " +
            $"'AgentHub scroll smoke line {ScrollSmokeLineCount} reached. Use mouse wheel or touchpad to scroll up.'";
        return new AgentStartupCommand(
            agentKind,
            "powershell.exe",
            ["-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", script]);
    }
}
