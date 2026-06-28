using AgentHub.Native.Core.Input;

namespace AgentHub.Native.Core.Collaboration;

public enum AgentMessageSendStatus
{
    Sent,
    ProfileOffline,
    TerminalNotReady,
    TerminalUnavailable
}

public sealed record AgentMessageSendResult(AgentMessageSendStatus Status)
{
    public bool Sent => Status == AgentMessageSendStatus.Sent;

    public static AgentMessageSendResult FromInputResult(AgentInputSendResult inputResult)
    {
        return inputResult.Status switch
        {
            AgentInputSendStatus.Sent => new AgentMessageSendResult(AgentMessageSendStatus.Sent),
            AgentInputSendStatus.TerminalNotReady => new AgentMessageSendResult(AgentMessageSendStatus.TerminalNotReady),
            _ => new AgentMessageSendResult(AgentMessageSendStatus.TerminalUnavailable)
        };
    }
}
