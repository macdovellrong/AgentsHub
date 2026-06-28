using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgentHub.Native.Core.Settings;

public sealed class NativeAppSettingsStore(string settingsPath)
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() }
    };

    public async Task<NativeAppSettings> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(settingsPath))
        {
            return NativeAppSettings.Default;
        }

        try
        {
            var raw = await File.ReadAllTextAsync(settingsPath, cancellationToken).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(raw))
            {
                return NativeAppSettings.Default;
            }

            return JsonSerializer.Deserialize<NativeAppSettings>(raw, SerializerOptions) ?? NativeAppSettings.Default;
        }
        catch (JsonException)
        {
            return NativeAppSettings.Default;
        }
    }

    public async Task SaveAsync(NativeAppSettings settings, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(settings);
        Directory.CreateDirectory(Path.GetDirectoryName(settingsPath)!);
        var json = JsonSerializer.Serialize(settings, SerializerOptions);
        await File.WriteAllTextAsync(settingsPath, $"{json}\n", cancellationToken).ConfigureAwait(false);
    }
}
