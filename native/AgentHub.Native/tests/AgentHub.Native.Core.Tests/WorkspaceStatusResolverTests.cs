using AgentHub.Native.Core.Workspaces;

namespace AgentHub.Native.Core.Tests;

public sealed class WorkspaceStatusResolverTests
{
    [Fact]
    public void Keeps_existing_specific_status_when_workspace_resolution_fails()
    {
        var status = WorkspaceStatusResolver.ResolveMissingWorkspaceStatus(
            "Workspace directory does not exist: V:\\Missing",
            "Select or add a workspace first");

        Assert.Equal("Workspace directory does not exist: V:\\Missing", status);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Uses_fallback_status_when_existing_status_is_empty(string? currentStatus)
    {
        var status = WorkspaceStatusResolver.ResolveMissingWorkspaceStatus(
            currentStatus,
            "Select or add a workspace first");

        Assert.Equal("Select or add a workspace first", status);
    }
}
