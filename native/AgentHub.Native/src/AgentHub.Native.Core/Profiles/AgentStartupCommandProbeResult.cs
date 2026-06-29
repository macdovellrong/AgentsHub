namespace AgentHub.Native.Core.Profiles;

public sealed record AgentStartupCommandProbeResult(bool Succeeded, string? Error)
{
    public static AgentStartupCommandProbeResult Success()
    {
        return new AgentStartupCommandProbeResult(true, null);
    }

    public static AgentStartupCommandProbeResult Failure(string error)
    {
        return new AgentStartupCommandProbeResult(false, error);
    }
}
