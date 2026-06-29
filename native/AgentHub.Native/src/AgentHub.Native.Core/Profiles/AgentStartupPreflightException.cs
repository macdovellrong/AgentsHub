namespace AgentHub.Native.Core.Profiles;

public sealed class AgentStartupPreflightException : InvalidOperationException
{
    public AgentStartupPreflightException(IReadOnlyList<string> errors)
        : base(string.Join(" ", errors))
    {
        Errors = errors;
    }

    public IReadOnlyList<string> Errors { get; }
}
