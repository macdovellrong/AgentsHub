namespace AgentHub.Native.Core.Profiles;

public sealed record AgentStartupPythonProbeResult(bool Succeeded, string? Error)
{
    public static AgentStartupPythonProbeResult Success()
    {
        return new AgentStartupPythonProbeResult(true, null);
    }

    public static AgentStartupPythonProbeResult Failure(string error)
    {
        return new AgentStartupPythonProbeResult(false, error);
    }
}
