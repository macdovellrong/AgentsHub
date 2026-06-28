using AgentHub.Native.App.Terminal;
using AgentHub.Native.Core.Input;

namespace AgentHub.Native.App.Tests;

public sealed class NativeTerminalSessionAdapterTests
{
    [Fact]
    public async Task Write_throws_not_ready_when_terminal_is_missing()
    {
        var connection = new FakeNativeTerminalConnection(hasTerminal: false);
        var adapter = new NativeTerminalSessionAdapter("codex-1", connection);

        await Assert.ThrowsAsync<AgentTerminalNotReadyException>(() => adapter.WriteAsync("hello"));

        Assert.Empty(connection.Writes);
    }

    [Fact]
    public async Task Write_throws_not_ready_when_terminal_process_has_not_started()
    {
        var connection = new FakeNativeTerminalConnection(isProcessStarted: false);
        var adapter = new NativeTerminalSessionAdapter("codex-1", connection);

        await Assert.ThrowsAsync<AgentTerminalNotReadyException>(() => adapter.WriteAsync("hello"));

        Assert.Empty(connection.Writes);
    }

    [Fact]
    public async Task Write_throws_when_terminal_process_has_exited()
    {
        var connection = new FakeNativeTerminalConnection(hasProcessExited: true);
        var adapter = new NativeTerminalSessionAdapter("codex-1", connection);

        await Assert.ThrowsAsync<InvalidOperationException>(() => adapter.WriteAsync("hello"));

        Assert.Empty(connection.Writes);
    }

    [Fact]
    public async Task Write_forwards_text_when_terminal_process_is_running()
    {
        var connection = new FakeNativeTerminalConnection();
        var adapter = new NativeTerminalSessionAdapter("codex-1", connection);

        await adapter.WriteAsync("hello");

        Assert.Equal(["hello"], connection.Writes);
    }

    [Fact]
    public async Task Stop_delegates_to_terminal_connection()
    {
        var connection = new FakeNativeTerminalConnection();
        var adapter = new NativeTerminalSessionAdapter("codex-1", connection);

        await adapter.StopAsync();

        Assert.True(connection.Stopped);
    }

    private sealed class FakeNativeTerminalConnection(
        bool hasTerminal = true,
        bool isProcessStarted = true,
        bool hasProcessExited = false) : INativeTerminalConnection
    {
        public bool HasTerminal { get; } = hasTerminal;
        public bool IsProcessStarted { get; } = isProcessStarted;
        public bool HasProcessExited { get; } = hasProcessExited;
        public List<string> Writes { get; } = [];
        public bool Stopped { get; private set; }

        public void WriteToTerminal(string text)
        {
            Writes.Add(text);
        }

        public void StopTerminal()
        {
            Stopped = true;
        }
    }
}
