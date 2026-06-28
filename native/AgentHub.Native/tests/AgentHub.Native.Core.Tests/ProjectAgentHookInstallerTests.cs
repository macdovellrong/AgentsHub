using System.Text.RegularExpressions;
using AgentHub.Native.Core.Hooks;

namespace AgentHub.Native.Core.Tests;

public sealed class ProjectAgentHookInstallerTests : IDisposable
{
    private readonly string tempRoot = Path.Combine(Path.GetTempPath(), "agenthub-native-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Installs_codex_claude_and_gemini_hooks_idempotently()
    {
        var sourceHooks = CreateHookSource();
        var workspace = Path.Combine(tempRoot, "workspace");

        await ProjectAgentHookInstaller.InstallAsync(
            workspace,
            new ProjectAgentHookInstallerOptions(sourceHooks, "py -3"));
        await ProjectAgentHookInstaller.InstallAsync(
            workspace,
            new ProjectAgentHookInstallerOptions(sourceHooks, "py -3"));

        Assert.True(File.Exists(Path.Combine(workspace, ".codex", "hooks", "agenthub_hook_common.py")));
        Assert.True(File.Exists(Path.Combine(workspace, ".codex", "hooks", "agenthub_codex_stop.py")));
        Assert.True(File.Exists(Path.Combine(workspace, ".claude", "hooks", "agenthub_claude_stop.py")));
        Assert.True(File.Exists(Path.Combine(workspace, ".gemini", "hooks", "agenthub_gemini_after_agent.py")));

        var codexConfig = await File.ReadAllTextAsync(Path.Combine(workspace, ".codex", "config.toml"));
        Assert.Contains("[features]", codexConfig);
        Assert.Contains("hooks = true", codexConfig);

        var codexHooks = await File.ReadAllTextAsync(Path.Combine(workspace, ".codex", "hooks.json"));
        var claudeSettings = await File.ReadAllTextAsync(Path.Combine(workspace, ".claude", "settings.local.json"));
        var geminiSettings = await File.ReadAllTextAsync(Path.Combine(workspace, ".gemini", "settings.json"));

        Assert.Single(Regex.Matches(codexHooks, "agenthub_codex_stop.py"));
        Assert.Equal(2, Regex.Matches(claudeSettings, "agenthub_claude_stop.py").Count);
        Assert.Single(Regex.Matches(geminiSettings, "agenthub_gemini_after_agent.py"));
    }

    public void Dispose()
    {
        if (Directory.Exists(tempRoot))
        {
            Directory.Delete(tempRoot, recursive: true);
        }
    }

    private string CreateHookSource()
    {
        var sourceHooks = Path.Combine(tempRoot, "hooks");
        Directory.CreateDirectory(sourceHooks);
        File.WriteAllText(Path.Combine(sourceHooks, "agenthub_hook_common.py"), "# common");
        File.WriteAllText(Path.Combine(sourceHooks, "agenthub_codex_stop.py"), "# codex");
        File.WriteAllText(Path.Combine(sourceHooks, "agenthub_claude_stop.py"), "# claude");
        File.WriteAllText(Path.Combine(sourceHooks, "agenthub_gemini_after_agent.py"), "# gemini");
        return sourceHooks;
    }
}
