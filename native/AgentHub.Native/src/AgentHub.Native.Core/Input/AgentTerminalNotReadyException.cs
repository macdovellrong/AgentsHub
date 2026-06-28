namespace AgentHub.Native.Core.Input;

public sealed class AgentTerminalNotReadyException : InvalidOperationException
{
    public AgentTerminalNotReadyException(string message)
        : base(message)
    {
    }

    public AgentTerminalNotReadyException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
