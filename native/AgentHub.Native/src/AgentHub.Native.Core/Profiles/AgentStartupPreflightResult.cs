namespace AgentHub.Native.Core.Profiles;

public sealed record AgentStartupPreflightResult(IReadOnlyList<string> Errors)
{
    public bool Succeeded => Errors.Count == 0;

    public void ThrowIfFailed()
    {
        if (Succeeded)
        {
            return;
        }

        throw new AgentStartupPreflightException(Errors);
    }
}
