namespace AgentHub.Native.Core.Input;

public enum AgentInputSendStatus
{
    Sent,
    SessionMissing,
    TerminalNotReady,
    TerminalFailed
}

public sealed record AgentInputSendResult(AgentInputSendStatus Status)
{
    public bool Sent => Status == AgentInputSendStatus.Sent;

    public bool ShouldRemoveSession =>
        Status is AgentInputSendStatus.SessionMissing or AgentInputSendStatus.TerminalFailed;
}
