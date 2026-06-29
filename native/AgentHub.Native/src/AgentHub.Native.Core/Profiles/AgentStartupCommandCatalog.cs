namespace AgentHub.Native.Core.Profiles;

public static class AgentStartupCommandCatalog
{
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
            (AgentKind.Codex, AgentStartupMode.Start) => new AgentStartupCommand(agentKind, "codex", []),
            (AgentKind.Codex, AgentStartupMode.Resume) => new AgentStartupCommand(agentKind, "codex", ["resume"]),
            (AgentKind.Claude, AgentStartupMode.Start) => new AgentStartupCommand(agentKind, "claude", []),
            (AgentKind.Gemini, AgentStartupMode.Start) => new AgentStartupCommand(agentKind, "gemini", []),
            _ => throw new NotSupportedException($"{mode} is not configured for {agentKind}.")
        };
    }
}
