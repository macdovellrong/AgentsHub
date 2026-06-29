namespace AgentHub.Native.Core.Profiles;

public static class AgentProfileIdResolver
{
    public static string Resolve(AgentKind agentKind, ShellKind shellKind)
    {
        if (agentKind == AgentKind.PowerShell && shellKind == ShellKind.Cmd)
        {
            return "cmd";
        }

        if (agentKind == AgentKind.ScrollTest)
        {
            return "scrolltest";
        }

        return agentKind.ToString().ToLowerInvariant();
    }
}
