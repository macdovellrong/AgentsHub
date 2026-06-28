using AgentHub.Native.Core.Input;
using EasyWindowsTerminalControl;

namespace AgentHub.Native.App.Terminal;

public sealed class EasyTerminalControlBackend(EasyTerminalControl terminal) : INativeTerminalBackend
{
    public bool HasTerminal => terminal.ConPTYTerm is not null;

    public bool IsProcessStarted => terminal.ConPTYTerm?.TermProcIsStarted == true;

    public bool HasProcessExited
    {
        get
        {
            var term = terminal.ConPTYTerm;
            return term is not null
                && term.TermProcIsStarted
                && term.Process.HasExited;
        }
    }

    public void WriteToTerminal(string text)
    {
        var term = terminal.ConPTYTerm
            ?? throw new AgentTerminalNotReadyException("Terminal backend is still starting.");
        term.WriteToTerm(text.AsSpan());
    }

    public void StopTerminal()
    {
        var term = terminal.ConPTYTerm;
        if (term is not null)
        {
            term.WriteToTerm("\x03".AsSpan());
            term.CloseStdinToApp();
            if (term.TermProcIsStarted && !term.Process.HasExited)
            {
                term.Process.Kill(EntireProcessTree: true);
            }

            term.StopExternalTermOnly();
        }

        terminal.DisconnectConPTYTerm();
    }
}
