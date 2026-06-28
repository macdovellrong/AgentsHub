using AgentHub.Native.Core.Settings;
using AgentHub.Native.Core.Profiles;

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
    public void Parses_shell_option_with_separate_value()
    {
        var options = NativeAppStartupOptions.Parse(["--shell", "cmd"]);

        Assert.Equal(ShellKind.Cmd, options.HostShell);
    }

    [Fact]
    public void Parses_shell_option_with_equals_value()
    {
        var options = NativeAppStartupOptions.Parse(["--shell=powershell"]);

        Assert.Equal(ShellKind.PowerShell, options.HostShell);
    }

    [Fact]
    public void Parses_python_option_with_separate_value()
    {
        var options = NativeAppStartupOptions.Parse(["--python", @"C:\Program Files\Python311\python.exe"]);

        Assert.Equal(@"C:\Program Files\Python311\python.exe", options.HookPythonCommand);
    }

    [Fact]
    public void Parses_python_option_with_equals_value()
    {
        var options = NativeAppStartupOptions.Parse(["--python=py -3.11"]);

        Assert.Equal("py -3.11", options.HookPythonCommand);
    }

    [Fact]
    public void Ignores_empty_or_missing_python_option()
    {
        Assert.Null(NativeAppStartupOptions.Parse(["--python"]).HookPythonCommand);
        Assert.Null(NativeAppStartupOptions.Parse(["--python", "   "]).HookPythonCommand);
    }

    [Fact]
    public void Ignores_unknown_shell_option()
    {
        var options = NativeAppStartupOptions.Parse(["--shell", "unknown"]);

        Assert.Null(options.HostShell);
    }

    [Fact]
    public void Ignores_empty_or_missing_workspace_value()
    {
        Assert.Null(NativeAppStartupOptions.Parse(["--workspace"]).InitialWorkspacePath);
        Assert.Null(NativeAppStartupOptions.Parse(["--workspace", "   "]).InitialWorkspacePath);
    }

    [Fact]
    public void Parses_agent_option_with_resume_flag()
    {
        var options = NativeAppStartupOptions.Parse(["--agent", "codex", "--resume"]);

        Assert.Equal(AgentKind.Codex, options.StartupAgentKind);
        Assert.Equal(AgentStartupMode.Resume, options.StartupMode);
    }

    [Fact]
    public void Parses_agent_option_with_equals_value()
    {
        var options = NativeAppStartupOptions.Parse(["--agent=claude"]);

        Assert.Equal(AgentKind.Claude, options.StartupAgentKind);
        Assert.Equal(AgentStartupMode.Start, options.StartupMode);
    }

    [Fact]
    public void Parses_shell_as_powershell_agent()
    {
        var options = NativeAppStartupOptions.Parse(["--agent", "powershell"]);

        Assert.Equal(AgentKind.PowerShell, options.StartupAgentKind);
        Assert.Equal(AgentStartupMode.Start, options.StartupMode);
    }

    [Fact]
    public void Applies_resume_only_to_codex()
    {
        var options = NativeAppStartupOptions.Parse(["--agent", "claude", "--resume"]);

        Assert.Equal(AgentKind.Claude, options.StartupAgentKind);
        Assert.Equal(AgentStartupMode.Start, options.StartupMode);
    }

    [Fact]
    public void Ignores_unknown_startup_agent()
    {
        var options = NativeAppStartupOptions.Parse(["--agent", "unknown", "--resume"]);

        Assert.Null(options.StartupAgentKind);
        Assert.Null(options.StartupMode);
    }
}
