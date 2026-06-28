namespace AgentHub.Native.Core.Input;

public interface IAgentTerminalSession
{
    string Id { get; }

    Task WriteAsync(string text, CancellationToken cancellationToken = default);
}
