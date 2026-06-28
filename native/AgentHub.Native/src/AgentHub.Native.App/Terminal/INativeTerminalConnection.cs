namespace AgentHub.Native.App.Terminal;

public interface INativeTerminalConnection
{
    Task WriteAsync(string text, CancellationToken cancellationToken = default);

    Task StopAsync(CancellationToken cancellationToken = default);
}
