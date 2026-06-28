using AgentHub.Native.Core.Input;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentInputRouterTests
{
    [Fact]
    public async Task Sends_text_and_enter_to_registered_session()
    {
        var session = new RecordingTerminalSession("codex-1");
        var router = new AgentInputRouter();
        router.Register(session);

        await router.SendLineAsync("codex-1", "hello");

        Assert.Equal(["hello", "\r"], session.Writes);
    }

    [Fact]
    public async Task Sends_multiline_text_as_bracketed_paste_then_enter()
    {
        var session = new RecordingTerminalSession("codex-1");
        var router = new AgentInputRouter();
        router.Register(session);

        await router.SendLineAsync("codex-1", "first line\r\nsecond line");

        Assert.Equal(["\x1b[200~", "first line\nsecond line", "\x1b[201~", "\r"], session.Writes);
    }

    [Fact]
    public async Task Sends_control_sequence_without_enter_to_registered_session()
    {
        var session = new RecordingTerminalSession("codex-1");
        var router = new AgentInputRouter();
        router.Register(session);

        await router.SendControlAsync("codex-1", "\x03");

        Assert.Equal(["\x03"], session.Writes);
    }

    [Fact]
    public async Task Throws_when_session_is_unknown()
    {
        var router = new AgentInputRouter();

        await Assert.ThrowsAsync<KeyNotFoundException>(() => router.SendLineAsync("missing", "hello"));
    }

    [Fact]
    public async Task Try_send_returns_false_when_session_is_unknown()
    {
        var router = new AgentInputRouter();

        var sent = await router.TrySendLineAsync("missing", "hello");

        Assert.False(sent);
    }

    [Fact]
    public async Task Try_send_returns_true_after_sending_to_registered_session()
    {
        var session = new RecordingTerminalSession("codex-1");
        var router = new AgentInputRouter();
        router.Register(session);

        var sent = await router.TrySendLineAsync("codex-1", "hello");

        Assert.True(sent);
        Assert.Equal(["hello", "\r"], session.Writes);
    }

    [Fact]
    public async Task Try_send_returns_false_and_unregisters_when_session_write_fails()
    {
        var session = new ThrowingWriteTerminalSession("codex-1");
        var router = new AgentInputRouter();
        router.Register(session);

        var sent = await router.TrySendLineAsync("codex-1", "hello");

        Assert.False(sent);
        Assert.True(session.WriteAttempted);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => router.SendLineAsync("codex-1", "hello"));
    }

    [Fact]
    public async Task Try_send_returns_false_and_keeps_session_when_terminal_is_not_ready()
    {
        var session = new NotReadyTerminalSession("codex-1");
        var router = new AgentInputRouter();
        router.Register(session);

        var sent = await router.TrySendLineAsync("codex-1", "hello");

        Assert.False(sent);
        Assert.True(session.WriteAttempted);
        await Assert.ThrowsAsync<AgentTerminalNotReadyException>(() => router.SendLineAsync("codex-1", "hello"));
    }

    [Fact]
    public async Task Try_send_detailed_reports_not_ready_without_unregistering_session()
    {
        var session = new NotReadyTerminalSession("codex-1");
        var router = new AgentInputRouter();
        router.Register(session);

        var result = await router.TrySendLineDetailedAsync("codex-1", "hello");

        Assert.Equal(AgentInputSendStatus.TerminalNotReady, result.Status);
        Assert.False(result.Sent);
        Assert.False(result.ShouldRemoveSession);
        Assert.True(session.WriteAttempted);
        await Assert.ThrowsAsync<AgentTerminalNotReadyException>(() => router.SendLineAsync("codex-1", "hello"));
    }

    [Fact]
    public async Task Try_send_control_reports_not_ready_without_unregistering_session()
    {
        var session = new NotReadyTerminalSession("codex-1");
        var router = new AgentInputRouter();
        router.Register(session);

        var result = await router.TrySendControlDetailedAsync("codex-1", "\x03");

        Assert.Equal(AgentInputSendStatus.TerminalNotReady, result.Status);
        Assert.False(result.Sent);
        Assert.False(result.ShouldRemoveSession);
        Assert.True(session.WriteAttempted);
        await Assert.ThrowsAsync<AgentTerminalNotReadyException>(() => router.SendLineAsync("codex-1", "hello"));
    }

    [Fact]
    public async Task Stops_and_unregisters_session()
    {
        var session = new RecordingTerminalSession("codex-1");
        var router = new AgentInputRouter();
        router.Register(session);

        await router.StopAsync("codex-1");

        Assert.True(session.Stopped);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => router.SendLineAsync("codex-1", "hello"));
    }

    [Fact]
    public async Task Stop_propagates_session_stop_failure_and_unregisters_session()
    {
        var session = new ThrowingStopTerminalSession("codex-1");
        var router = new AgentInputRouter();
        router.Register(session);

        await Assert.ThrowsAsync<InvalidOperationException>(() => router.StopAsync("codex-1"));

        Assert.True(session.StopAttempted);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => router.SendLineAsync("codex-1", "hello"));
    }

    [Fact]
    public async Task Try_stop_returns_false_when_session_is_unknown()
    {
        var router = new AgentInputRouter();

        var stopped = await router.TryStopAsync("missing");

        Assert.False(stopped);
    }

    [Fact]
    public async Task Try_stop_stops_and_unregisters_existing_session()
    {
        var session = new RecordingTerminalSession("codex-1");
        var router = new AgentInputRouter();
        router.Register(session);

        var stopped = await router.TryStopAsync("codex-1");

        Assert.True(stopped);
        Assert.True(session.Stopped);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => router.SendLineAsync("codex-1", "hello"));
    }

    [Fact]
    public async Task Try_stop_returns_false_and_unregisters_when_session_stop_fails()
    {
        var session = new ThrowingStopTerminalSession("codex-1");
        var router = new AgentInputRouter();
        router.Register(session);

        var stopped = await router.TryStopAsync("codex-1");

        Assert.False(stopped);
        Assert.True(session.StopAttempted);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => router.SendLineAsync("codex-1", "hello"));
    }

    [Fact]
    public async Task Stops_all_registered_sessions_and_unregisters_them()
    {
        var codex = new RecordingTerminalSession("codex-1");
        var claude = new RecordingTerminalSession("claude-1");
        var router = new AgentInputRouter();
        router.Register(codex);
        router.Register(claude);

        var stoppedCount = await router.StopAllAsync();

        Assert.Equal(2, stoppedCount);
        Assert.True(codex.Stopped);
        Assert.True(claude.Stopped);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => router.SendLineAsync("codex-1", "hello"));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => router.SendLineAsync("claude-1", "hello"));
        Assert.Equal(0, await router.StopAllAsync());
    }

    [Fact]
    public async Task Stop_all_continues_when_a_session_stop_fails()
    {
        var failing = new ThrowingStopTerminalSession("codex-1");
        var later = new RecordingTerminalSession("claude-1");
        var router = new AgentInputRouter();
        router.Register(failing);
        router.Register(later);

        var stoppedCount = await router.StopAllAsync();

        Assert.Equal(2, stoppedCount);
        Assert.True(failing.StopAttempted);
        Assert.True(later.Stopped);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => router.SendLineAsync("codex-1", "hello"));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => router.SendLineAsync("claude-1", "hello"));
    }

    private sealed class RecordingTerminalSession(string id) : IAgentTerminalSession
    {
        public string Id { get; } = id;
        public List<string> Writes { get; } = [];
        public bool Stopped { get; private set; }

        public Task WriteAsync(string text, CancellationToken cancellationToken = default)
        {
            Writes.Add(text);
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken = default)
        {
            Stopped = true;
            return Task.CompletedTask;
        }
    }

    private sealed class ThrowingStopTerminalSession(string id) : IAgentTerminalSession
    {
        public string Id { get; } = id;
        public bool StopAttempted { get; private set; }

        public Task WriteAsync(string text, CancellationToken cancellationToken = default)
        {
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken = default)
        {
            StopAttempted = true;
            throw new InvalidOperationException("stop failed");
        }
    }

    private sealed class ThrowingWriteTerminalSession(string id) : IAgentTerminalSession
    {
        public string Id { get; } = id;
        public bool WriteAttempted { get; private set; }

        public Task WriteAsync(string text, CancellationToken cancellationToken = default)
        {
            WriteAttempted = true;
            throw new InvalidOperationException("write failed");
        }

        public Task StopAsync(CancellationToken cancellationToken = default)
        {
            return Task.CompletedTask;
        }
    }

    private sealed class NotReadyTerminalSession(string id) : IAgentTerminalSession
    {
        public string Id { get; } = id;
        public bool WriteAttempted { get; private set; }

        public Task WriteAsync(string text, CancellationToken cancellationToken = default)
        {
            WriteAttempted = true;
            throw new AgentTerminalNotReadyException("terminal is still starting");
        }

        public Task StopAsync(CancellationToken cancellationToken = default)
        {
            return Task.CompletedTask;
        }
    }
}
