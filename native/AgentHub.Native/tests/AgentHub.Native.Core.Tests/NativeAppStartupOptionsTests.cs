using AgentHub.Native.Core.Settings;

namespace AgentHub.Native.Core.Tests;

public sealed class NativeAppStartupOptionsTests
{
    [Fact]
    public void Parses_workspace_option_with_separate_value()
    {
        var options = NativeAppStartupOptions.Parse(["--workspace", @"V:\OrderManager\"]);

        Assert.Equal(@"V:\OrderManager", options.InitialWorkspacePath);
    }

    [Fact]
    public void Parses_workspace_option_with_equals_value()
    {
        var options = NativeAppStartupOptions.Parse(["--workspace=D:\\GoldAgent"]);

        Assert.Equal(@"D:\GoldAgent", options.InitialWorkspacePath);
    }

    [Fact]
    public void Parses_short_workspace_option()
    {
        var options = NativeAppStartupOptions.Parse(["-w", @"D:\GoldAgent"]);

        Assert.Equal(@"D:\GoldAgent", options.InitialWorkspacePath);
    }

    [Fact]
    public void Ignores_empty_or_missing_workspace_value()
    {
        Assert.Null(NativeAppStartupOptions.Parse(["--workspace"]).InitialWorkspacePath);
        Assert.Null(NativeAppStartupOptions.Parse(["--workspace", "   "]).InitialWorkspacePath);
    }
}
