using AgentHub.Native.Core.Input;

namespace AgentHub.Native.App.Terminal;

public sealed class DispatchingNativeTerminalConnection(
    INativeTerminalBackend backend,
    INativeTerminalInvoker invoker) : INativeTerminalConnection
{
    public Task WriteAsync(string text, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(text);
        return invoker.InvokeAsync(() =>
        {
            if (!backend.HasTerminal || !backend.IsProcessStarted)
            {
                throw new AgentTerminalNotReadyException("Terminal backend is still starting.");
            }

            if (backend.HasProcessExited)
            {
                throw new InvalidOperationException("Terminal process has exited.");
            }

            backend.WriteToTerminal(text);
        }, cancellationToken);
    }

    public Task StopAsync(CancellationToken cancellationToken = default)
    {
        return invoker.InvokeAsync(backend.StopTerminal, cancellationToken);
    }
}
