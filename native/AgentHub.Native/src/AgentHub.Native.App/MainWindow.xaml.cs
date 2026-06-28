using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using AgentHub.Native.App.Terminal;
using AgentHub.Native.Core.Collaboration;
using AgentHub.Native.Core.Hooks;
using AgentHub.Native.Core.Input;
using AgentHub.Native.Core.Processes;
using AgentHub.Native.Core.Profiles;
using AgentHub.Native.Core.Workspaces;
using EasyWindowsTerminalControl;

namespace AgentHub.Native.App;

public partial class MainWindow : Window
{
    private readonly AgentInputRouter inputRouter = new();
    private readonly AgentSessionRegistry sessionRegistry = new();
    private readonly Dictionary<string, SessionViewModel> sessions = new(StringComparer.OrdinalIgnoreCase);
    private readonly WorkspaceStore workspaceStore = new(ResolveWorkspaceStorePath());
    private int nextSessionNumber = 1;
    private string? selectedSessionId;
    private AgentHookReceiver? hookReceiver;
    private AgentHookReceiverInfo? hookInfo;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += MainWindow_Loaded;
        Closed += MainWindow_Closed;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        hookReceiver = new AgentHookReceiver(new AgentHookReceiverOptions(0, Guid.NewGuid().ToString("N")));
        hookReceiver.EventReceived += HookReceiver_EventReceived;
        hookInfo = await hookReceiver.StartAsync();
        StatusTextBlock.Text = $"Hook receiver: {hookInfo.Url}";
        await ReloadWorkspacesAsync();
    }

    private async void MainWindow_Closed(object? sender, EventArgs e)
    {
        if (hookReceiver is not null)
        {
            await hookReceiver.DisposeAsync();
        }
    }

    private async void AddWorkspace_Click(object sender, RoutedEventArgs e)
    {
        await AddCurrentWorkspaceAsync();
    }

    private async void RemoveWorkspace_Click(object sender, RoutedEventArgs e)
    {
        var workspacePath = CurrentWorkspacePath();
        if (workspacePath is null)
        {
            StatusTextBlock.Text = "No workspace selected";
            return;
        }

        await workspaceStore.RemoveAsync(workspacePath);
        await ReloadWorkspacesAsync();
        StatusTextBlock.Text = "Workspace removed";
    }

    private void WorkspaceListBox_SelectionChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
    {
        if (WorkspaceListBox.SelectedItem is WorkspaceEntry workspace)
        {
            WorkspaceTextBox.Text = workspace.Path;
        }
    }

    private void HookReceiver_EventReceived(object? sender, AgentHookEvent hookEvent)
    {
        Dispatcher.Invoke(() =>
        {
            var profile = hookEvent.ProfileId ?? hookEvent.Source ?? "agent";
            HookMessagesListBox.Items.Insert(0, $"{DateTime.Now:HH:mm:ss} {profile}: {hookEvent.Message}");
            StatusTextBlock.Text = $"Hook received: {profile}";
        });
    }

    private async void StartCodex_Click(object sender, RoutedEventArgs e)
    {
        await StartAgentAsync(AgentKind.Codex, "codex", []);
    }

    private async void StartClaude_Click(object sender, RoutedEventArgs e)
    {
        await StartAgentAsync(AgentKind.Claude, "claude", []);
    }

    private async void StartGemini_Click(object sender, RoutedEventArgs e)
    {
        await StartAgentAsync(AgentKind.Gemini, "gemini", []);
    }

    private async void StartPowerShell_Click(object sender, RoutedEventArgs e)
    {
        await StartAgentAsync(AgentKind.PowerShell, "", []);
    }

    private async Task StartAgentAsync(AgentKind agentKind, string command, IReadOnlyList<string> args)
    {
        var workspace = await AddCurrentWorkspaceAsync();
        if (workspace is null)
        {
            StatusTextBlock.Text = "Select or add a workspace first";
            return;
        }

        if (agentKind != AgentKind.PowerShell)
        {
            StatusTextBlock.Text = "Installing project hooks...";
            await ProjectAgentHookInstaller.InstallAsync(
                workspace.Path,
                new ProjectAgentHookInstallerOptions(ResolveHookScriptsDirectory(), "py -3"));
        }

        var sessionId = $"{agentKind.ToString().ToLowerInvariant()}-{nextSessionNumber++}";
        var profileId = agentKind.ToString().ToLowerInvariant();
        var runId = $"{sessionId}-{DateTimeOffset.Now:yyyyMMddHHmmss}";
        var env = hookInfo is null
            ? null
            : HookEnvironmentBuilder.Build(new HookEnvironmentRequest(
                hookInfo.Url,
                hookInfo.Token,
                sessionId,
                runId,
                profileId,
                workspace.Path));
        var request = new AgentLaunchRequest(agentKind, ShellKind.PowerShell, workspace.Path, command, args, env);
        var plan = AgentLaunchPlanBuilder.Build(request);
        var startupCommandLine = WindowsCommandLineBuilder.Build(plan.Executable, plan.Arguments);

        var terminal = new EasyTerminalControl
        {
            StartupCommandLine = startupCommandLine,
            LogConPTYOutput = false,
            FontSizeWhenSettingTheme = 14
        };

        var session = new SessionViewModel(sessionId, agentKind, workspace, terminal);
        sessions[sessionId] = session;
        inputRouter.Register(new NativeTerminalSessionAdapter(sessionId, terminal));
        sessionRegistry.Register(new AgentSessionDescriptor(sessionId, profileId, workspace.Path, DateTimeOffset.UtcNow));
        SessionListBox.Items.Add(session);
        SessionListBox.SelectedItem = session;
        StatusTextBlock.Text = $"Started {session.DisplayName}";
    }

    private async Task<WorkspaceEntry?> AddCurrentWorkspaceAsync()
    {
        var workspacePath = CurrentWorkspacePath();
        if (workspacePath is null)
        {
            return null;
        }

        var workspace = await workspaceStore.AddOrUpdateAsync(workspacePath);
        await ReloadWorkspacesAsync(workspace.Path);
        return workspace;
    }

    private string? CurrentWorkspacePath()
    {
        if (WorkspaceListBox.SelectedItem is WorkspaceEntry workspace)
        {
            return workspace.Path;
        }

        var typedPath = WorkspaceTextBox.Text.Trim();
        return string.IsNullOrWhiteSpace(typedPath) ? null : typedPath;
    }

    private async Task ReloadWorkspacesAsync(string? selectPath = null)
    {
        var workspaces = await workspaceStore.LoadAsync();
        WorkspaceListBox.Items.Clear();
        foreach (var workspace in workspaces)
        {
            WorkspaceListBox.Items.Add(workspace);
        }

        if (workspaces.Count == 0)
        {
            return;
        }

        var selected = selectPath is null
            ? workspaces[0]
            : workspaces.FirstOrDefault(workspace =>
                string.Equals(workspace.Path, selectPath, StringComparison.OrdinalIgnoreCase)) ?? workspaces[0];
        WorkspaceListBox.SelectedItem = selected;
        WorkspaceTextBox.Text = selected.Path;
    }

    private static string ResolveWorkspaceStorePath()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var root = string.IsNullOrWhiteSpace(appData)
            ? Path.Combine(AppContext.BaseDirectory, ".agenthub-native")
            : Path.Combine(appData, "AgentHub", "Native");
        return Path.Combine(root, "workspaces.json");
    }

    private static string ResolveHookScriptsDirectory()
    {
        var environmentOverride = Environment.GetEnvironmentVariable("AGENTHUB_HOOKS_SOURCE_DIR");
        var candidates = new List<string>();
        if (!string.IsNullOrWhiteSpace(environmentOverride))
        {
            candidates.Add(environmentOverride);
        }

        AddAncestorCandidates(candidates, Directory.GetCurrentDirectory());
        AddAncestorCandidates(candidates, AppContext.BaseDirectory);
        foreach (var candidate in candidates)
        {
            if (File.Exists(Path.Combine(candidate, "agenthub_hook_common.py")))
            {
                return candidate;
            }
        }

        throw new DirectoryNotFoundException($"AgentHub hook scripts not found. Checked: {string.Join(", ", candidates)}");
    }

    private static void AddAncestorCandidates(List<string> candidates, string startDirectory)
    {
        var directory = new DirectoryInfo(startDirectory);
        while (directory is not null)
        {
            candidates.Add(Path.Combine(directory.FullName, "scripts", "hooks"));
            directory = directory.Parent;
        }
    }

    private async void SendInput_Click(object sender, RoutedEventArgs e)
    {
        await SendCurrentInputAsync();
    }

    private async void StopSession_Click(object sender, RoutedEventArgs e)
    {
        if (SessionListBox.SelectedItem is not SessionViewModel session)
        {
            StatusTextBlock.Text = "No selected session";
            return;
        }

        await inputRouter.StopAsync(session.Id);
        sessionRegistry.Remove(session.Id);
        sessions.Remove(session.Id);
        SessionListBox.Items.Remove(session);
        if (selectedSessionId == session.Id)
        {
            selectedSessionId = null;
            TerminalHostGrid.Children.Clear();
            CurrentSessionTextBlock.Text = "No session";
        }

        StatusTextBlock.Text = $"Stopped {session.Id}";
    }

    private async void InjectTextBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter)
        {
            return;
        }

        e.Handled = true;
        await SendCurrentInputAsync();
    }

    private async Task SendCurrentInputAsync()
    {
        var text = InjectTextBox.Text;
        if (string.IsNullOrEmpty(text))
        {
            return;
        }

        await SendTextToTargetAsync(text);
        InjectTextBox.Clear();
    }

    private async Task SendTextToTargetAsync(string text)
    {
        var selectedTarget = TargetProfileComboBox.SelectedItem is ComboBoxItem item
            ? item.Content?.ToString()
            : null;

        if (string.IsNullOrWhiteSpace(selectedTarget) || selectedTarget == "Selected session")
        {
            if (selectedSessionId is null)
            {
                StatusTextBlock.Text = "No selected session";
                return;
            }

            await inputRouter.SendLineAsync(selectedSessionId!, text);
            StatusTextBlock.Text = $"Sent input to {selectedSessionId}";
            return;
        }

        var workspacePath = CurrentWorkspacePath();
        if (workspacePath is null)
        {
            StatusTextBlock.Text = "No workspace selected";
            return;
        }

        var messageRouter = new AgentMessageRouter(inputRouter, sessionRegistry);
        await messageRouter.SendToProfileAsync(workspacePath, selectedTarget, text);
        StatusTextBlock.Text = $"Sent input to latest {selectedTarget}";
    }

    private void SessionListBox_SelectionChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
    {
        if (SessionListBox.SelectedItem is not SessionViewModel session)
        {
            return;
        }

        selectedSessionId = session.Id;
        CurrentSessionTextBlock.Text = session.DisplayName;
        TerminalHostGrid.Children.Clear();
        TerminalHostGrid.Children.Add(session.Terminal);
    }

    private sealed record SessionViewModel(
        string Id,
        AgentKind AgentKind,
        WorkspaceEntry Workspace,
        EasyTerminalControl Terminal)
    {
        public string DisplayName => $"{AgentKind} / {Workspace.Name}";

        public override string ToString()
        {
            return $"{Id}  {DisplayName}";
        }
    }
}
