using EasyWindowsTerminalControl;

namespace AgentHub.Native.App.Terminal;

public sealed class EasyTerminalControlConnection(EasyTerminalControl terminal) : INativeTerminalConnection
{
    private readonly DispatchingNativeTerminalConnection connection = new(
        new EasyTerminalControlBackend(terminal),
        new WpfNativeTerminalInvoker(terminal.Dispatcher));

    public Task WriteAsync(string text, CancellationToken cancellationToken = default)
    {
        return connection.WriteAsync(text, cancellationToken);
    }

    public Task StopAsync(CancellationToken cancellationToken = default)
    {
        return connection.StopAsync(cancellationToken);
    }
}
