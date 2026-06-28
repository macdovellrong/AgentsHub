namespace AgentHub.Native.App.Terminal;

public interface INativeTerminalBackend
{
    bool HasTerminal { get; }

    bool IsProcessStarted { get; }

    bool HasProcessExited { get; }

    void WriteToTerminal(string text);

    void StopTerminal();
}
