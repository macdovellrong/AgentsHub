namespace AgentHub.Native.Core.Profiles;

public static class AgentProfileIdResolver
{
    public static string Resolve(AgentKind agentKind, ShellKind shellKind)
    {
        if (agentKind == AgentKind.PowerShell && shellKind == ShellKind.Cmd)
        {
            return "cmd";
        }

        return agentKind.ToString().ToLowerInvariant();
    }
}
