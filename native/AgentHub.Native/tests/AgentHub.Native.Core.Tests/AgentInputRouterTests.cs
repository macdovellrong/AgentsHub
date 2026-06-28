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
    public async Task Throws_when_session_is_unknown()
    {
        var router = new AgentInputRouter();

        await Assert.ThrowsAsync<KeyNotFoundException>(() => router.SendLineAsync("missing", "hello"));
    }

    private sealed class RecordingTerminalSession(string id) : IAgentTerminalSession
    {
        public string Id { get; } = id;
        public List<string> Writes { get; } = [];

        public Task WriteAsync(string text, CancellationToken cancellationToken = default)
        {
            Writes.Add(text);
            return Task.CompletedTask;
        }
    }
}
