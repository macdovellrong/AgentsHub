using System.Windows.Threading;

namespace AgentHub.Native.App.Terminal;

public sealed class WpfNativeTerminalInvoker(Dispatcher dispatcher) : INativeTerminalInvoker
{
    public Task InvokeAsync(Action action, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (dispatcher.CheckAccess())
        {
            action();
            return Task.CompletedTask;
        }

        return dispatcher.InvokeAsync(action, DispatcherPriority.Send, cancellationToken).Task;
    }
}
