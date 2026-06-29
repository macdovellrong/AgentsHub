using AgentHub.Native.Core.Profiles;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentStartupPreflightCheckerTests
{
    [Fact]
    public void Allows_plain_shell_without_agent_cli_or_hooks()
    {
        var checker = new AgentStartupPreflightChecker(
            _ => null,
            _ => false,
            _ => false);

        var result = checker.Check(new AgentStartupPreflightRequest(
            AgentStartupCommandCatalog.Build(AgentKind.PowerShell, AgentStartupMode.Start),
            HookScriptsDirectory: null,
            HookPythonCommand: null));

        Assert.True(result.Succeeded);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public void Reports_missing_agent_cli_for_managed_agent()
    {
        var checker = new AgentStartupPreflightChecker(
            _ => null,
            path => RequiredHookFiles().Contains(Path.GetFileName(path), StringComparer.Ordinal),
            _ => true);

        var result = checker.Check(new AgentStartupPreflightRequest(
            AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Resume),
            @"V:\AgentHub\scripts\hooks",
            "py -3"));

        Assert.False(result.Succeeded);
        Assert.Contains("Agent CLI 'codex' was not found in PATH.", result.Errors);
    }

    [Fact]
    public void Reports_missing_hook_script_for_managed_agent()
    {
        var checker = new AgentStartupPreflightChecker(
            command => command == "codex" || command == "py" ? command : null,
            path => !string.Equals(Path.GetFileName(path), "agenthub_gemini_after_agent.py", StringComparison.Ordinal),
            _ => true,
            (_, _) => AgentStartupPythonProbeResult.Success());

        var result = checker.Check(new AgentStartupPreflightRequest(
            AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Start),
            @"V:\AgentHub\scripts\hooks",
            "py -3"));

        Assert.False(result.Succeeded);
        Assert.Contains(@"AgentHub hook script was not found: V:\AgentHub\scripts\hooks\agenthub_gemini_after_agent.py", result.Errors);
    }

    [Fact]
    public void Reports_missing_python_launcher_for_managed_agent_hooks()
    {
        var checker = new AgentStartupPreflightChecker(
            command => command == "codex" ? command : null,
            path => RequiredHookFiles().Contains(Path.GetFileName(path), StringComparer.Ordinal),
            _ => true);

        var result = checker.Check(new AgentStartupPreflightRequest(
            AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Start),
            @"V:\AgentHub\scripts\hooks",
            "py -3.11"));

        Assert.False(result.Succeeded);
        Assert.Contains("Hook Python launcher 'py' was not found in PATH.", result.Errors);
    }

    [Fact]
    public void Accepts_quoted_python_path_with_arguments()
    {
        (string Launcher, IReadOnlyList<string> Arguments)? probedCommand = null;
        var checker = new AgentStartupPreflightChecker(
            command => command is "codex" ? command : null,
            path => RequiredHookFiles().Contains(Path.GetFileName(path), StringComparer.Ordinal)
                || string.Equals(path, @"C:\Program Files\Python311\python.exe", StringComparison.OrdinalIgnoreCase),
            path => string.Equals(path, @"V:\AgentHub\scripts\hooks", StringComparison.OrdinalIgnoreCase),
            (launcher, arguments) =>
            {
                probedCommand = (launcher, arguments);
                return AgentStartupPythonProbeResult.Success();
            });

        var result = checker.Check(new AgentStartupPreflightRequest(
            AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Start),
            @"V:\AgentHub\scripts\hooks",
            "\"C:\\Program Files\\Python311\\python.exe\" -I"));

        Assert.True(result.Succeeded);
        Assert.Empty(result.Errors);
        Assert.Equal(@"C:\Program Files\Python311\python.exe", probedCommand?.Launcher);
        Assert.Equal(["-I"], probedCommand?.Arguments);
    }

    [Fact]
    public void Reports_hook_python_probe_failure()
    {
        var checker = new AgentStartupPreflightChecker(
            command => command is "codex" or "py" ? command : null,
            path => RequiredHookFiles().Contains(Path.GetFileName(path), StringComparer.Ordinal),
            _ => true,
            (_, _) => AgentStartupPythonProbeResult.Failure("exit code 1: Python 3.14 cannot run AgentHub hooks"));

        var result = checker.Check(new AgentStartupPreflightRequest(
            AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Start),
            @"V:\AgentHub\scripts\hooks",
            "py -3.14"));

        Assert.False(result.Succeeded);
        Assert.Contains("Hook Python check failed: exit code 1: Python 3.14 cannot run AgentHub hooks", result.Errors);
    }

    [Fact]
    public void Reports_unsupported_codex_no_alt_screen_argument()
    {
        var checker = new AgentStartupPreflightChecker(
            command => command is "codex" or "py" ? command : null,
            path => RequiredHookFiles().Contains(Path.GetFileName(path), StringComparer.Ordinal),
            _ => true,
            (_, _) => AgentStartupPythonProbeResult.Success(),
            (_, _) => AgentStartupCommandProbeResult.Failure("Codex CLI does not support --no-alt-screen."));

        var result = checker.Check(new AgentStartupPreflightRequest(
            AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Resume),
            @"V:\AgentHub\scripts\hooks",
            "py -3.11"));

        Assert.False(result.Succeeded);
        Assert.Contains("Agent CLI check failed: Codex CLI does not support --no-alt-screen.", result.Errors);
    }

    [Fact]
    public void Probes_codex_no_alt_screen_support_with_resolved_cli_path()
    {
        (string Launcher, IReadOnlyList<string> Arguments)? probedCommand = null;
        var checker = new AgentStartupPreflightChecker(
            command => command switch
            {
                "codex" => @"C:\Users\saber\AppData\Roaming\npm\codex.cmd",
                "py" => @"C:\Windows\py.exe",
                _ => null
            },
            path => RequiredHookFiles().Contains(Path.GetFileName(path), StringComparer.Ordinal),
            _ => true,
            (_, _) => AgentStartupPythonProbeResult.Success(),
            (launcher, startupCommand) =>
            {
                probedCommand = (launcher, startupCommand.Arguments);
                return AgentStartupCommandProbeResult.Success();
            });

        var result = checker.Check(new AgentStartupPreflightRequest(
            AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Resume),
            @"V:\AgentHub\scripts\hooks",
            "py -3.11"));

        Assert.True(result.Succeeded);
        Assert.Equal(@"C:\Users\saber\AppData\Roaming\npm\codex.cmd", probedCommand?.Launcher);
        Assert.Equal(["--no-alt-screen", "resume"], probedCommand?.Arguments);
    }

    [Fact]
    public void Prefers_windows_pathext_launchers_before_extensionless_npm_shims()
    {
        var originalPathExt = Environment.GetEnvironmentVariable("PATHEXT");
        Environment.SetEnvironmentVariable("PATHEXT", ".COM;.EXE;.BAT;.CMD");

        try
        {
            var method = typeof(AgentStartupPreflightChecker)
                .GetMethod("CandidateCommandNames", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
            Assert.NotNull(method);

            var candidates = Assert.IsAssignableFrom<IReadOnlyList<string>>(method.Invoke(null, ["codex"]));

            Assert.Equal("codex.COM", candidates[0]);
            Assert.Equal("codex.EXE", candidates[1]);
            Assert.Equal("codex.BAT", candidates[2]);
            Assert.Equal("codex.CMD", candidates[3]);
            Assert.Equal("codex", candidates[^1]);
        }
        finally
        {
            Environment.SetEnvironmentVariable("PATHEXT", originalPathExt);
        }
    }

    [Fact]
    public void Probes_with_resolved_python_executable_path()
    {
        (string Launcher, IReadOnlyList<string> Arguments)? probedCommand = null;
        var checker = new AgentStartupPreflightChecker(
            command => command switch
            {
                "codex" => "codex.cmd",
                "py" => @"C:\Windows\py.exe",
                _ => null
            },
            path => RequiredHookFiles().Contains(Path.GetFileName(path), StringComparer.Ordinal),
            _ => true,
            (launcher, arguments) =>
            {
                probedCommand = (launcher, arguments);
                return AgentStartupPythonProbeResult.Success();
            });

        var result = checker.Check(new AgentStartupPreflightRequest(
            AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Start),
            @"V:\AgentHub\scripts\hooks",
            "py -3.11"));

        Assert.True(result.Succeeded);
        Assert.Equal(@"C:\Windows\py.exe", probedCommand?.Launcher);
        Assert.Equal(["-3.11"], probedCommand?.Arguments);
    }

    private static IReadOnlySet<string> RequiredHookFiles()
    {
        return new HashSet<string>(StringComparer.Ordinal)
        {
            "agenthub_hook_common.py",
            "agenthub_codex_stop.py",
            "agenthub_claude_stop.py",
            "agenthub_gemini_after_agent.py"
        };
    }
}
