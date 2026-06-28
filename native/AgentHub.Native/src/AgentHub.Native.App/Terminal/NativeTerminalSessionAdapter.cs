using AgentHub.Native.Core.Input;
using EasyWindowsTerminalControl;

namespace AgentHub.Native.App.Terminal;

public sealed class NativeTerminalSessionAdapter(string id, EasyTerminalControl terminal) : IAgentTerminalSession
{
    public string Id { get; } = id;

    public Task WriteAsync(string text, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        terminal.ConPTYTerm?.WriteToTerm(text.AsSpan());
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var term = terminal.ConPTYTerm;
        if (term is not null)
        {
            term.WriteToTerm("\x03".AsSpan());
            term.CloseStdinToApp();
            if (!term.Process.HasExited)
            {
                term.Process.Kill(EntireProcessTree: true);
            }

            term.StopExternalTermOnly();
        }

        terminal.DisconnectConPTYTerm();
        return Task.CompletedTask;
    }
}
