using System.Text.Json;
using System.Text.Json.Nodes;

namespace AgentHub.Native.Core.Hooks;

public static class ProjectAgentHookInstaller
{
    private const string HookCommonScript = "agenthub_hook_common.py";
    private const string CodexHookScript = "agenthub_codex_stop.py";
    private const string ClaudeHookScript = "agenthub_claude_stop.py";
    private const string GeminiHookScript = "agenthub_gemini_after_agent.py";

    public static async Task InstallAsync(
        string workspacePath,
        ProjectAgentHookInstallerOptions options,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(workspacePath);
        ArgumentNullException.ThrowIfNull(options);

        await InstallCodexHooksAsync(workspacePath, options, cancellationToken).ConfigureAwait(false);
        await InstallClaudeHooksAsync(workspacePath, options, cancellationToken).ConfigureAwait(false);
        await InstallGeminiHooksAsync(workspacePath, options, cancellationToken).ConfigureAwait(false);
    }

    private static async Task InstallCodexHooksAsync(
        string workspacePath,
        ProjectAgentHookInstallerOptions options,
        CancellationToken cancellationToken)
    {
        var codexDir = Path.Combine(workspacePath, ".codex");
        var hooksDir = Path.Combine(codexDir, "hooks");
        await CopyHookScriptsAsync(options.SourceHooksDirectory, hooksDir, CodexHookScript, cancellationToken)
            .ConfigureAwait(false);
        await UpdateCodexConfigAsync(Path.Combine(codexDir, "config.toml"), cancellationToken).ConfigureAwait(false);
        await UpdateJsonFileAsync(Path.Combine(codexDir, "hooks.json"), settings =>
        {
            var hooks = EnsureObject(settings, "hooks");
            hooks["Stop"] = UpsertHookGroup(ToArray(hooks["Stop"]), CodexHookScript, new JsonObject
            {
                ["hooks"] = new JsonArray
                {
                    BuildCommandHook(options.PythonLauncher, Path.Combine(hooksDir, CodexHookScript), timeout: 5)
                }
            });
            return settings;
        }, cancellationToken).ConfigureAwait(false);
    }

    private static async Task InstallClaudeHooksAsync(
        string workspacePath,
        ProjectAgentHookInstallerOptions options,
        CancellationToken cancellationToken)
    {
        var claudeDir = Path.Combine(workspacePath, ".claude");
        var hooksDir = Path.Combine(claudeDir, "hooks");
        await CopyHookScriptsAsync(options.SourceHooksDirectory, hooksDir, ClaudeHookScript, cancellationToken)
            .ConfigureAwait(false);
        await UpdateJsonFileAsync(Path.Combine(claudeDir, "settings.local.json"), settings =>
        {
            var hooks = EnsureObject(settings, "hooks");
            hooks["Stop"] = UpsertHookGroup(ToArray(hooks["Stop"]), ClaudeHookScript, BuildClaudeHookGroup(options, hooksDir));
            hooks["StopFailure"] =
                UpsertHookGroup(ToArray(hooks["StopFailure"]), ClaudeHookScript, BuildClaudeHookGroup(options, hooksDir));
            return settings;
        }, cancellationToken).ConfigureAwait(false);
    }

    private static async Task InstallGeminiHooksAsync(
        string workspacePath,
        ProjectAgentHookInstallerOptions options,
        CancellationToken cancellationToken)
    {
        var geminiDir = Path.Combine(workspacePath, ".gemini");
        var hooksDir = Path.Combine(geminiDir, "hooks");
        await CopyHookScriptsAsync(options.SourceHooksDirectory, hooksDir, GeminiHookScript, cancellationToken)
            .ConfigureAwait(false);
        await UpdateJsonFileAsync(Path.Combine(geminiDir, "settings.json"), settings =>
        {
            var hooks = EnsureObject(settings, "hooks");
            hooks["AfterAgent"] = UpsertHookGroup(ToArray(hooks["AfterAgent"]), GeminiHookScript, new JsonObject
            {
                ["matcher"] = "*",
                ["hooks"] = new JsonArray
                {
                    BuildCommandHook(options.PythonLauncher, Path.Combine(hooksDir, GeminiHookScript), timeout: 5000, name: "agenthub-result")
                }
            });
            return settings;
        }, cancellationToken).ConfigureAwait(false);
    }

    private static JsonObject BuildClaudeHookGroup(ProjectAgentHookInstallerOptions options, string hooksDir)
    {
        return new JsonObject
        {
            ["hooks"] = new JsonArray
            {
                BuildCommandHook(options.PythonLauncher, Path.Combine(hooksDir, ClaudeHookScript), timeout: 5)
            }
        };
    }

    private static JsonObject BuildCommandHook(string pythonLauncher, string scriptPath, int timeout, string? name = null)
    {
        var hook = new JsonObject
        {
            ["type"] = "command",
            ["command"] = BuildPythonCommand(pythonLauncher, scriptPath),
            ["timeout"] = timeout
        };
        if (!string.IsNullOrWhiteSpace(name))
        {
            hook["name"] = name;
        }

        return hook;
    }

    private static async Task CopyHookScriptsAsync(
        string sourceHooksDir,
        string targetHooksDir,
        string entryScript,
        CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(targetHooksDir);
        await CopyFileAsync(Path.Combine(sourceHooksDir, HookCommonScript), Path.Combine(targetHooksDir, HookCommonScript), cancellationToken)
            .ConfigureAwait(false);
        await CopyFileAsync(Path.Combine(sourceHooksDir, entryScript), Path.Combine(targetHooksDir, entryScript), cancellationToken)
            .ConfigureAwait(false);
    }

    private static async Task CopyFileAsync(string source, string target, CancellationToken cancellationToken)
    {
        await using var input = File.OpenRead(source);
        await using var output = File.Create(target);
        await input.CopyToAsync(output, cancellationToken).ConfigureAwait(false);
    }

    private static async Task UpdateCodexConfigAsync(string configPath, CancellationToken cancellationToken)
    {
        var raw = await ReadOptionalTextAsync(configPath, cancellationToken).ConfigureAwait(false);
        Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);
        await File.WriteAllTextAsync(configPath, EnsureCodexHooksFeature(raw), cancellationToken).ConfigureAwait(false);
    }

    private static string EnsureCodexHooksFeature(string raw)
    {
        var text = StripBom(raw).Replace("\r\n", "\n", StringComparison.Ordinal);
        if (string.IsNullOrWhiteSpace(text))
        {
            return "[features]\nhooks = true\n";
        }

        var lines = text.EndsWith('\n') ? text[..^1].Split('\n').ToList() : text.Split('\n').ToList();
        var sectionStart = lines.FindIndex(line => line.Trim() == "[features]");
        if (sectionStart < 0)
        {
            return $"{string.Join('\n', lines).TrimEnd()}\n\n[features]\nhooks = true\n";
        }

        var sectionEnd = lines.Count;
        for (var index = sectionStart + 1; index < lines.Count; index += 1)
        {
            var trimmed = lines[index].Trim();
            if (trimmed.StartsWith('[') && trimmed.EndsWith(']'))
            {
                sectionEnd = index;
                break;
            }
        }

        var hookLineIndex = -1;
        for (var index = sectionStart + 1; index < sectionEnd; index += 1)
        {
            if (lines[index].TrimStart().StartsWith("hooks", StringComparison.Ordinal) &&
                lines[index].Contains('=', StringComparison.Ordinal))
            {
                hookLineIndex = index;
                break;
            }
        }

        if (hookLineIndex >= 0)
        {
            lines[hookLineIndex] = "hooks = true";
        }
        else
        {
            lines.Insert(sectionStart + 1, "hooks = true");
            sectionEnd += 1;
        }

        for (var index = sectionEnd - 1; index > sectionStart; index -= 1)
        {
            if (lines[index].TrimStart().StartsWith("codex_hooks", StringComparison.Ordinal) &&
                lines[index].Contains('=', StringComparison.Ordinal))
            {
                lines.RemoveAt(index);
            }
        }

        return $"{string.Join('\n', lines).TrimEnd()}\n";
    }

    private static async Task UpdateJsonFileAsync(
        string filePath,
        Func<JsonObject, JsonObject> update,
        CancellationToken cancellationToken)
    {
        var settings = ParseJsonObject(await ReadOptionalTextAsync(filePath, cancellationToken).ConfigureAwait(false), filePath);
        Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
        var updated = update(settings);
        await File.WriteAllTextAsync(
            filePath,
            $"{updated.ToJsonString(new JsonSerializerOptions { WriteIndented = true })}\n",
            cancellationToken).ConfigureAwait(false);
    }

    private static JsonObject ParseJsonObject(string raw, string filePath)
    {
        var text = StripBom(raw).Trim();
        if (text.Length == 0)
        {
            return [];
        }

        var parsed = JsonNode.Parse(text) ?? throw new InvalidOperationException($"Expected JSON object in {filePath}.");
        return parsed as JsonObject ?? throw new InvalidOperationException($"Expected JSON object in {filePath}.");
    }

    private static async Task<string> ReadOptionalTextAsync(string filePath, CancellationToken cancellationToken)
    {
        return File.Exists(filePath)
            ? await File.ReadAllTextAsync(filePath, cancellationToken).ConfigureAwait(false)
            : "";
    }

    private static JsonObject EnsureObject(JsonObject parent, string key)
    {
        if (parent[key] is JsonObject existing)
        {
            return existing;
        }

        var next = new JsonObject();
        parent[key] = next;
        return next;
    }

    private static JsonArray ToArray(JsonNode? value)
    {
        return value as JsonArray ?? [];
    }

    private static JsonArray UpsertHookGroup(JsonArray existingGroups, string markerScriptName, JsonObject nextGroup)
    {
        var next = new JsonArray();
        foreach (var group in existingGroups)
        {
            if (group is null || group.ToJsonString().Contains(markerScriptName, StringComparison.Ordinal))
            {
                continue;
            }

            next.Add(group.DeepClone());
        }

        next.Add(nextGroup);
        return next;
    }

    private static string BuildPythonCommand(string pythonLauncher, string scriptPath)
    {
        return $"{pythonLauncher} {QuoteCommandArgument(scriptPath)}";
    }

    private static string QuoteCommandArgument(string value)
    {
        return $"\"{value.Replace("\"", "\\\"", StringComparison.Ordinal)}\"";
    }

    private static string StripBom(string value)
    {
        return value.Length > 0 && value[0] == '\uFEFF' ? value[1..] : value;
    }
}
