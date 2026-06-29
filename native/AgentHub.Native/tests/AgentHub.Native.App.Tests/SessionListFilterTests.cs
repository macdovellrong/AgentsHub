namespace AgentHub.Native.App.Tests;

public sealed class SessionListFilterTests
{
    [Fact]
    public void Keeps_all_sessions_when_current_workspace_filter_is_disabled()
    {
        var sessions = new[]
        {
            new TestSession("codex-1", @"V:\OrderManager"),
            new TestSession("claude-1", @"V:\GoldAgent")
        };

        var visible = SessionListFilter.Filter(
            sessions,
            @"V:\OrderManager",
            currentWorkspaceOnly: false,
            session => session.WorkspacePath);

        Assert.Equal(["codex-1", "claude-1"], visible.Select(session => session.Id));
    }

    [Fact]
    public void Keeps_only_sessions_from_current_workspace_when_filter_is_enabled()
    {
        var sessions = new[]
        {
            new TestSession("codex-1", @"V:\OrderManager"),
            new TestSession("claude-1", @"V:\GoldAgent"),
            new TestSession("gemini-1", @"V:\OrderManager\")
        };

        var visible = SessionListFilter.Filter(
            sessions,
            @"V:\OrderManager",
            currentWorkspaceOnly: true,
            session => session.WorkspacePath);

        Assert.Equal(["codex-1", "gemini-1"], visible.Select(session => session.Id));
    }

    [Fact]
    public void Keeps_all_sessions_when_current_workspace_is_unknown()
    {
        var sessions = new[]
        {
            new TestSession("codex-1", @"V:\OrderManager"),
            new TestSession("claude-1", @"V:\GoldAgent")
        };

        var visible = SessionListFilter.Filter(
            sessions,
            null,
            currentWorkspaceOnly: true,
            session => session.WorkspacePath);

        Assert.Equal(["codex-1", "claude-1"], visible.Select(session => session.Id));
    }

    private sealed record TestSession(string Id, string WorkspacePath);
}
