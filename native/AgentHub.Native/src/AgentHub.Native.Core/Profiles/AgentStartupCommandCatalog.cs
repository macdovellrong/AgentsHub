namespace AgentHub.Native.Core.Profiles;

public static class AgentStartupCommandCatalog
{
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
