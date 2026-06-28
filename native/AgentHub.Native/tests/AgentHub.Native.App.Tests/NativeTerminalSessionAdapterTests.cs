using AgentHub.Native.App.Terminal;
using AgentHub.Native.Core.Input;

namespace AgentHub.Native.App.Tests;

public sealed class NativeTerminalSessionAdapterTests
{
    [Fact]
    public async Task Write_delegates_to_terminal_connection()
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

    [Fact]
    public async Task Dispatching_connection_checks_and_writes_inside_invoker()
    {
        var invoker = new RecordingNativeTerminalInvoker();
        var backend = new GuardedNativeTerminalBackend(invoker);
        var connection = new DispatchingNativeTerminalConnection(backend, invoker);

        await connection.WriteAsync("hello");

        Assert.Equal(["hello"], backend.Writes);
        Assert.Equal(1, invoker.InvocationCount);
    }

    [Fact]
    public async Task Dispatching_connection_throws_not_ready_when_terminal_is_missing()
    {
        var invoker = new RecordingNativeTerminalInvoker();
        var backend = new GuardedNativeTerminalBackend(invoker)
        {
            HasTerminalValue = false
        };
        var connection = new DispatchingNativeTerminalConnection(backend, invoker);

        await Assert.ThrowsAsync<AgentTerminalNotReadyException>(() => connection.WriteAsync("hello"));

        Assert.Empty(backend.Writes);
        Assert.Equal(1, invoker.InvocationCount);
    }

    [Fact]
    public async Task Dispatching_connection_throws_not_ready_when_terminal_process_has_not_started()
    {
        var invoker = new RecordingNativeTerminalInvoker();
        var backend = new GuardedNativeTerminalBackend(invoker)
        {
            IsProcessStartedValue = false
        };
        var connection = new DispatchingNativeTerminalConnection(backend, invoker);

        await Assert.ThrowsAsync<AgentTerminalNotReadyException>(() => connection.WriteAsync("hello"));

        Assert.Empty(backend.Writes);
        Assert.Equal(1, invoker.InvocationCount);
    }

    [Fact]
    public async Task Dispatching_connection_throws_when_terminal_process_has_exited()
    {
        var invoker = new RecordingNativeTerminalInvoker();
        var backend = new GuardedNativeTerminalBackend(invoker)
        {
            HasProcessExitedValue = true
        };
        var connection = new DispatchingNativeTerminalConnection(backend, invoker);

        await Assert.ThrowsAsync<InvalidOperationException>(() => connection.WriteAsync("hello"));

        Assert.Empty(backend.Writes);
        Assert.Equal(1, invoker.InvocationCount);
    }

    [Fact]
    public async Task Dispatching_connection_stops_inside_invoker()
    {
        var invoker = new RecordingNativeTerminalInvoker();
        var backend = new GuardedNativeTerminalBackend(invoker);
        var connection = new DispatchingNativeTerminalConnection(backend, invoker);

        await connection.StopAsync();

        Assert.True(backend.Stopped);
        Assert.Equal(1, invoker.InvocationCount);
    }

    private sealed class FakeNativeTerminalConnection : INativeTerminalConnection
    {
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

    private sealed class RecordingNativeTerminalInvoker : INativeTerminalInvoker
    {
        public int InvocationCount { get; private set; }
        public bool IsInsideInvocation { get; private set; }

        public Task InvokeAsync(Action action, CancellationToken cancellationToken = default)
        {
            InvocationCount++;
            IsInsideInvocation = true;
            try
            {
                action();
            }
            finally
            {
                IsInsideInvocation = false;
            }

            return Task.CompletedTask;
        }
    }

    private sealed class GuardedNativeTerminalBackend(RecordingNativeTerminalInvoker invoker) : INativeTerminalBackend
    {
        public bool HasTerminalValue { get; init; } = true;
        public bool IsProcessStartedValue { get; init; } = true;
        public bool HasProcessExitedValue { get; init; }
        public List<string> Writes { get; } = [];
        public bool Stopped { get; private set; }

        public bool HasTerminal
        {
            get
            {
                Assert.True(invoker.IsInsideInvocation);
                return HasTerminalValue;
            }
        }

        public bool IsProcessStarted
        {
            get
            {
                Assert.True(invoker.IsInsideInvocation);
                return IsProcessStartedValue;
            }
        }

        public bool HasProcessExited
        {
            get
            {
                Assert.True(invoker.IsInsideInvocation);
                return HasProcessExitedValue;
            }
        }

        public void WriteToTerminal(string text)
        {
            Assert.True(invoker.IsInsideInvocation);
            Writes.Add(text);
        }

        public void StopTerminal()
        {
            Assert.True(invoker.IsInsideInvocation);
            Stopped = true;
        }
    }
}
