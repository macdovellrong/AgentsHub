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
}
