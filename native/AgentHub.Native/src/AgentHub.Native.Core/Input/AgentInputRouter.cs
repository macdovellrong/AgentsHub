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

        await session.WriteAsync(text, cancellationToken).ConfigureAwait(false);
        await session.WriteAsync("\r", cancellationToken).ConfigureAwait(false);
    }

    public async Task StopAsync(string sessionId, CancellationToken cancellationToken = default)
    {
        if (!sessions.Remove(sessionId, out var session))
        {
            throw new KeyNotFoundException($"Agent terminal session '{sessionId}' was not found.");
        }

        await session.StopAsync(cancellationToken).ConfigureAwait(false);
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
}
