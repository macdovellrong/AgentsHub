using AgentHub.Native.Core.Profiles;
using AgentHub.Native.Core.Settings;

namespace AgentHub.Native.Core.Tests;

public sealed class NativeAppSettingsStoreTests : IDisposable
{
    private readonly string tempRoot = Path.Combine(Path.GetTempPath(), "agenthub-native-settings", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Loads_default_settings_when_file_is_missing()
    {
        var store = new NativeAppSettingsStore(Path.Combine(tempRoot, "settings.json"));

        var settings = await store.LoadAsync();

        Assert.Equal(ShellKind.PowerShell, settings.HostShell);
    }

    [Fact]
    public async Task Saves_and_loads_host_shell()
    {
        var settingsPath = Path.Combine(tempRoot, "settings.json");
        var store = new NativeAppSettingsStore(settingsPath);

        await store.SaveAsync(new NativeAppSettings(ShellKind.Cmd));

        var reloaded = await new NativeAppSettingsStore(settingsPath).LoadAsync();
        Assert.Equal(ShellKind.Cmd, reloaded.HostShell);
        Assert.Contains("\"hostShell\": \"Cmd\"", await File.ReadAllTextAsync(settingsPath));
    }

    [Fact]
    public async Task Falls_back_to_defaults_when_file_is_invalid()
    {
        var settingsPath = Path.Combine(tempRoot, "settings.json");
        Directory.CreateDirectory(tempRoot);
        await File.WriteAllTextAsync(settingsPath, "{ broken json");
        var store = new NativeAppSettingsStore(settingsPath);

        var settings = await store.LoadAsync();

        Assert.Equal(ShellKind.PowerShell, settings.HostShell);
    }

    public void Dispose()
    {
        if (Directory.Exists(tempRoot))
        {
            Directory.Delete(tempRoot, recursive: true);
        }
    }
}
