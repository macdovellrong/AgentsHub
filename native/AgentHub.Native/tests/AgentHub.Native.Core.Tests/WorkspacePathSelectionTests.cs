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
}
