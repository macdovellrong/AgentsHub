namespace AgentHub.Native.App.Terminal;

public interface INativeTerminalInvoker
{
    Task InvokeAsync(Action action, CancellationToken cancellationToken = default);
}
