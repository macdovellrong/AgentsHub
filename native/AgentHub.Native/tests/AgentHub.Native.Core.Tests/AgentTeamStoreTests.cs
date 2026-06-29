using AgentHub.Native.Core.Collaboration;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentTeamStoreTests : IDisposable
{
    private readonly string workspacePath = Path.Combine(Path.GetTempPath(), "agenthub-native-team-store", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Creates_default_team_config_and_appends_mailbox_records()
    {
        var store = new AgentTeamStore();

        var team = await store.EnsureTeamAsync(workspacePath, new AgentTeamRequest(
            "default",
            "Default Team",
            ["claude", "codex", "gemini"]));
        var message = await store.AppendMailboxAsync(workspacePath, new AgentTeamMailboxRequest(
            "default",
            "send_message",
            "claude",
            "codex",
            "Implement task A.",
            "T-001",
            null,
            "sent",
            "codex-1",
            null));

        var loadedTeam = await store.GetTeamAsync(workspacePath, "default");
        var mailbox = await store.ListMailboxAsync(workspacePath, "default");
        var rawMailbox = await File.ReadAllTextAsync(Path.Combine(workspacePath, ".agenthub", "teams", "default", "mailbox.jsonl"));

        Assert.Equal("default", team.Id);
        Assert.Equal("Default Team", loadedTeam?.Name);
        Assert.Equal(["claude", "codex", "gemini"], loadedTeam?.MemberProfileIds);
        var loadedMessage = Assert.Single(mailbox);
        Assert.Equal(message.Id, loadedMessage.Id);
        Assert.Equal("send_message", loadedMessage.Action);
        Assert.Equal("claude", loadedMessage.FromProfileId);
        Assert.Equal("codex", loadedMessage.ToProfileId);
        Assert.Equal("sent", loadedMessage.Status);
        Assert.Equal("codex-1", loadedMessage.SessionId);
        Assert.Contains("\"teamId\":\"default\"", rawMailbox);
    }

    [Fact]
    public async Task Persists_plan_id_on_mailbox_records()
    {
        var store = new AgentTeamStore();

        await store.AppendMailboxAsync(workspacePath, new AgentTeamMailboxRequest(
            "default",
            "assign_task",
            "claude",
            "codex",
            "Implement task A.",
            "T-001",
            null,
            "sent",
            "codex-1",
            null,
            PlanId: "P-001"));

        var mailbox = await store.ListMailboxAsync(workspacePath, "default");
        var rawMailbox = await File.ReadAllTextAsync(Path.Combine(workspacePath, ".agenthub", "teams", "default", "mailbox.jsonl"));

        var message = Assert.Single(mailbox);
        Assert.Equal("P-001", message.PlanId);
        Assert.Contains("\"planId\":\"P-001\"", rawMailbox);
    }

    [Fact]
    public async Task Sanitizes_team_id_paths_and_skips_invalid_mailbox_lines()
    {
        var store = new AgentTeamStore();
        await store.AppendMailboxAsync(workspacePath, new AgentTeamMailboxRequest(
            "review/team:alpha",
            "claim_task",
            "codex",
            null,
            "Task claimed",
            "T-002",
            null,
            "observed",
            null,
            null));
        var mailboxPath = Path.Combine(workspacePath, ".agenthub", "teams", "review_team_alpha", "mailbox.jsonl");
        await File.AppendAllTextAsync(mailboxPath, "{ broken json\n");

        var mailbox = await store.ListMailboxAsync(workspacePath, "review/team:alpha");

        Assert.Single(mailbox);
        Assert.Equal("claim_task", mailbox[0].Action);
    }

    public void Dispose()
    {
        if (Directory.Exists(workspacePath))
        {
            Directory.Delete(workspacePath, recursive: true);
        }
    }
}
