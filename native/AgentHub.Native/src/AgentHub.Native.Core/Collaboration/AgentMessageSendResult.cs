using AgentHub.Native.Core.Input;

namespace AgentHub.Native.Core.Collaboration;

public enum AgentMessageSendStatus
{
    Sent,
    ProfileOffline,
    TerminalNotReady,
    TerminalUnavailable
}

public sealed record AgentMessageSendResult(AgentMessageSendStatus Status, string? SessionId = null)
{
    public bool Sent => Status == AgentMessageSendStatus.Sent;

    public static AgentMessageSendResult FromInputResult(AgentInputSendResult inputResult, string? sessionId = null)
    {
        return inputResult.Status switch
        {
            AgentInputSendStatus.Sent => new AgentMessageSendResult(AgentMessageSendStatus.Sent, sessionId),
            AgentInputSendStatus.TerminalNotReady => new AgentMessageSendResult(AgentMessageSendStatus.TerminalNotReady, sessionId),
            _ => new AgentMessageSendResult(AgentMessageSendStatus.TerminalUnavailable, sessionId)
        };
    }
}
