using System.Net;
using System.Net.Http.Json;
using AgentHub.Native.Core.Hooks;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentHookReceiverTests
{
    [Fact]
    public async Task Accepts_authorized_agent_result_payload()
    {
        await using var receiver = new AgentHookReceiver(new AgentHookReceiverOptions(0, "token-1"));
        var received = new List<AgentHookEvent>();
        receiver.EventReceived += (_, hookEvent) => received.Add(hookEvent);
        var info = await receiver.StartAsync();

        using var client = new HttpClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, info.Url)
        {
            Content = JsonContent.Create(new
            {
                workspace = @"V:\OrderManager",
                message = "done",
                profileId = "codex",
                agenthubSessionId = "codex-1",
                runId = "run-1",
                source = "codex"
            })
        };
        request.Headers.Add("X-AgentHub-Token", "token-1");

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var hookEvent = Assert.Single(received);
        Assert.Equal(@"V:\OrderManager", hookEvent.Workspace);
        Assert.Equal("done", hookEvent.Message);
        Assert.Equal("codex", hookEvent.ProfileId);
        Assert.Equal("codex-1", hookEvent.SessionId);
        Assert.Equal("run-1", hookEvent.RunId);
        Assert.Equal("codex", hookEvent.Source);
    }

    [Fact]
    public async Task Rejects_invalid_token()
    {
        await using var receiver = new AgentHookReceiver(new AgentHookReceiverOptions(0, "token-1"));
        var info = await receiver.StartAsync();

        using var client = new HttpClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, info.Url)
        {
            Content = JsonContent.Create(new { workspace = @"V:\OrderManager", message = "done" })
        };
        request.Headers.Add("X-AgentHub-Token", "wrong");

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
