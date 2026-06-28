using AgentHub.Native.Core.Workspaces;

namespace AgentHub.Native.Core.Tests;

public sealed class WorkspacePathSelectionTests
{
    [Theory]
    [InlineData(@"V:\OrderManager\", @"V:\OrderManager")]
    [InlineData(@"  D:\GoldAgent  ", @"D:\GoldAgent")]
    public void Normalizes_selected_workspace_path(string raw, string expected)
    {
        Assert.Equal(expected, WorkspacePathSelection.NormalizeSelectedPath(raw));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Returns_null_for_empty_selection(string? raw)
    {
        Assert.Null(WorkspacePathSelection.NormalizeSelectedPath(raw));
    }

    [Fact]
    public void Prefers_typed_workspace_path_over_selected_workspace_path()
    {
        var path = WorkspacePathSelection.ResolveCurrentPath(
            @"D:\GoldAgent",
            @"V:\OrderManager");

        Assert.Equal(@"D:\GoldAgent", path);
    }

    [Fact]
    public void Falls_back_to_selected_workspace_path_when_typed_path_is_empty()
    {
        var path = WorkspacePathSelection.ResolveCurrentPath(
            "   ",
            @"V:\OrderManager\");

        Assert.Equal(@"V:\OrderManager", path);
    }

    [Fact]
    public void Prefers_selected_workspace_path_for_removal()
    {
        var path = WorkspacePathSelection.ResolveRemovalPath(
            @"D:\Typed",
            @"V:\Selected");

        Assert.Equal(@"V:\Selected", path);
    }

    [Fact]
    public void Falls_back_to_typed_workspace_path_for_removal_when_selection_is_empty()
    {
        var path = WorkspacePathSelection.ResolveRemovalPath(
            @"D:\Typed\",
            null);

        Assert.Equal(@"D:\Typed", path);
    }
}
