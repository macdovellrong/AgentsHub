using AgentHub.Native.Core.Input;
using EasyWindowsTerminalControl;

namespace AgentHub.Native.App.Terminal;

public sealed class NativeTerminalSessionAdapter : IAgentTerminalSession
{
    private readonly INativeTerminalConnection connection;

    public NativeTerminalSessionAdapter(string id, EasyTerminalControl terminal)
        : this(id, new EasyTerminalControlConnection(terminal))
    {
    }

    public NativeTerminalSessionAdapter(string id, INativeTerminalConnection connection)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(id);
        ArgumentNullException.ThrowIfNull(connection);
        Id = id;
        this.connection = connection;
    }

    public string Id { get; }

    public Task WriteAsync(string text, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!connection.HasTerminal || !connection.IsProcessStarted)
        {
            throw new AgentTerminalNotReadyException($"Agent terminal session '{Id}' is still starting.");
        }

        if (connection.HasProcessExited)
        {
            throw new InvalidOperationException($"Agent terminal session '{Id}' has exited.");
        }

        connection.WriteToTerminal(text);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        connection.StopTerminal();
        return Task.CompletedTask;
    }
}
