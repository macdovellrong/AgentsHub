namespace AgentHub.Native.Core.Input;

public sealed class AgentInputRouter
{
    private readonly Dictionary<string, IAgentTerminalSession> sessions = new(StringComparer.OrdinalIgnoreCase);

    public void Register(IAgentTerminalSession session)
    {
        ArgumentNullException.ThrowIfNull(session);
        sessions[session.Id] = session;
    }

    public async Task SendLineAsync(string sessionId, string text, CancellationToken cancellationToken = default)
    {
        if (!sessions.TryGetValue(sessionId, out var session))
        {
            throw new KeyNotFoundException($"Agent terminal session '{sessionId}' was not found.");
        }

        if (IsMultiline(text))
        {
            await session.WriteAsync("\x1b[200~", cancellationToken).ConfigureAwait(false);
            await session.WriteAsync(NormalizeLineEndings(text), cancellationToken).ConfigureAwait(false);
            await session.WriteAsync("\x1b[201~", cancellationToken).ConfigureAwait(false);
        }
        else
        {
            await session.WriteAsync(text, cancellationToken).ConfigureAwait(false);
        }

        await session.WriteAsync("\r", cancellationToken).ConfigureAwait(false);
    }

    public async Task StopAsync(string sessionId, CancellationToken cancellationToken = default)
    {
        if (!await TryStopAsync(sessionId, cancellationToken).ConfigureAwait(false))
        {
            throw new KeyNotFoundException($"Agent terminal session '{sessionId}' was not found.");
        }
    }

    public async Task<bool> TryStopAsync(string sessionId, CancellationToken cancellationToken = default)
    {
        if (!sessions.Remove(sessionId, out var session))
        {
            return false;
        }

        await session.StopAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    public async Task<int> StopAllAsync(CancellationToken cancellationToken = default)
    {
        var currentSessions = sessions.Values.ToArray();
        sessions.Clear();
        foreach (var session in currentSessions)
        {
            try
            {
                await session.StopAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch
            {
                // Shutdown is best-effort: one broken terminal must not leave later sessions running.
            }
        }

        return currentSessions.Length;
    }

    private static bool IsMultiline(string text)
    {
        return text.Contains('\n') || text.Contains('\r');
    }

    private static string NormalizeLineEndings(string text)
    {
        return text.Replace("\r\n", "\n").Replace('\r', '\n');
    }
}
