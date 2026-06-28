namespace AgentHub.Native.App.Terminal;

public interface INativeTerminalConnection
{
    bool HasTerminal { get; }

    bool IsProcessStarted { get; }

    bool HasProcessExited { get; }

    void WriteToTerminal(string text);

    void StopTerminal();
}
