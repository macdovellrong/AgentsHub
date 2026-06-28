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
    private readonly CollaborationEventStore collaborationEventStore = new(ResolveCollaborationEventsDirectory());
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

    private async void WorkspaceListBox_SelectionChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
    {
        if (WorkspaceListBox.SelectedItem is WorkspaceEntry workspace)
        {
            WorkspaceTextBox.Text = workspace.Path;
            await ReloadTimelineAsync(workspace.Path);
        }
    }

    private async void HookReceiver_EventReceived(object? sender, AgentHookEvent hookEvent)
    {
        try
        {
            await collaborationEventStore.AppendAgentOutputAsync(hookEvent);
            await Dispatcher.InvokeAsync(() =>
            {
                var profile = hookEvent.ProfileId ?? hookEvent.Source ?? "agent";
                StatusTextBlock.Text = $"Hook received: {profile}";
            });

            var shouldReload = await Dispatcher.InvokeAsync(() => IsCurrentWorkspace(hookEvent.Workspace));
            if (shouldReload)
            {
                await ReloadTimelineAsync(hookEvent.Workspace);
            }
        }
        catch (Exception ex)
        {
            await Dispatcher.InvokeAsync(() =>
            {
                StatusTextBlock.Text = $"Hook record failed: {ex.Message}";
            });
        }
    }

    private async void StartCodex_Click(object sender, RoutedEventArgs e)
    {
        await StartAgentAsync(AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Start));
    }

    private async void ResumeCodex_Click(object sender, RoutedEventArgs e)
    {
        await StartAgentAsync(AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Resume));
    }

    private async void StartClaude_Click(object sender, RoutedEventArgs e)
    {
        await StartAgentAsync(AgentStartupCommandCatalog.Build(AgentKind.Claude, AgentStartupMode.Start));
    }

    private async void StartGemini_Click(object sender, RoutedEventArgs e)
    {
        await StartAgentAsync(AgentStartupCommandCatalog.Build(AgentKind.Gemini, AgentStartupMode.Start));
    }

    private async void StartPowerShell_Click(object sender, RoutedEventArgs e)
    {
        await StartAgentAsync(AgentStartupCommandCatalog.Build(AgentKind.PowerShell, AgentStartupMode.Start));
    }

    private async Task StartAgentAsync(AgentStartupCommand startupCommand)
    {
        var workspace = await AddCurrentWorkspaceAsync();
        if (workspace is null)
        {
            StatusTextBlock.Text = "Select or add a workspace first";
            return;
        }

        if (startupCommand.AgentKind != AgentKind.PowerShell)
        {
            StatusTextBlock.Text = "Installing project hooks...";
            await ProjectAgentHookInstaller.InstallAsync(
                workspace.Path,
                new ProjectAgentHookInstallerOptions(ResolveHookScriptsDirectory(), "py -3"));
        }

        var shellKind = SelectedShellKind();
        var profileId = AgentProfileIdResolver.Resolve(startupCommand.AgentKind, shellKind);
        var sessionId = $"{profileId}-{nextSessionNumber++}";
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
        var request = new AgentLaunchRequest(
            startupCommand.AgentKind,
            shellKind,
            workspace.Path,
            startupCommand.Command,
            startupCommand.Arguments,
            env);
        var plan = AgentLaunchPlanBuilder.Build(request);
        var startupCommandLine = WindowsCommandLineBuilder.Build(plan.Executable, plan.Arguments);

        var terminal = new EasyTerminalControl
        {
            StartupCommandLine = startupCommandLine,
            LogConPTYOutput = false,
            FontSizeWhenSettingTheme = 14
        };

        var session = new SessionViewModel(sessionId, startupCommand.AgentKind, shellKind, workspace, terminal);
        sessions[sessionId] = session;
        inputRouter.Register(new NativeTerminalSessionAdapter(sessionId, terminal));
        sessionRegistry.Register(new AgentSessionDescriptor(sessionId, profileId, workspace.Path, DateTimeOffset.UtcNow));
        SessionListBox.Items.Add(session);
        SessionListBox.SelectedItem = session;
        StatusTextBlock.Text = $"Started {session.DisplayName}";
    }

    private ShellKind SelectedShellKind()
    {
        var selected = HostShellComboBox.SelectedItem is ComboBoxItem item
            ? item.Content?.ToString()
            : null;
        return string.Equals(selected, "cmd", StringComparison.OrdinalIgnoreCase)
            ? ShellKind.Cmd
            : ShellKind.PowerShell;
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
        return Path.Combine(ResolveNativeDataDirectory(), "workspaces.json");
    }

    private static string ResolveCollaborationEventsDirectory()
    {
        return Path.Combine(ResolveNativeDataDirectory(), "events");
    }

    private static string ResolveNativeDataDirectory()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return string.IsNullOrWhiteSpace(appData)
            ? Path.Combine(AppContext.BaseDirectory, ".agenthub-native")
            : Path.Combine(appData, "AgentHub", "Native");
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
            var selectedWorkspacePath = sessions.TryGetValue(selectedSessionId, out var selectedSession)
                ? selectedSession.Workspace.Path
                : CurrentWorkspacePath();
            if (selectedWorkspacePath is not null)
            {
                await RecordUserMessageAsync(selectedWorkspacePath, selectedSessionId, text);
            }

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
        await RecordUserMessageAsync(workspacePath, selectedTarget, text);
        StatusTextBlock.Text = $"Sent input to latest {selectedTarget}";
    }

    private async Task ReloadTimelineAsync(string workspacePath)
    {
        var events = await collaborationEventStore.ListAsync(workspacePath);
        await Dispatcher.InvokeAsync(() =>
        {
            TimelineListBox.Items.Clear();
            foreach (var item in events.OrderByDescending(item => item.Timestamp).Take(200))
            {
                TimelineListBox.Items.Add(CollaborationTimelineFormatter.Format(item, TimeZoneInfo.Local));
            }
        });
    }

    private bool IsCurrentWorkspace(string workspacePath)
    {
        var current = CurrentWorkspacePath();
        return current is not null
            && string.Equals(
                NormalizeWorkspaceForCompare(current),
                NormalizeWorkspaceForCompare(workspacePath),
                StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeWorkspaceForCompare(string workspacePath)
    {
        return workspacePath.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private async Task RecordUserMessageAsync(string workspacePath, string targetProfileId, string text)
    {
        await collaborationEventStore.AppendUserMessageAsync(new CollaborationUserMessage(
            workspacePath,
            "user",
            targetProfileId,
            text));
        await ReloadTimelineAsync(workspacePath);
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
        ShellKind ShellKind,
        WorkspaceEntry Workspace,
        EasyTerminalControl Terminal)
    {
        public string DisplayName => AgentKind == AgentKind.PowerShell
            ? $"{ShellKind} / {Workspace.Name}"
            : $"{AgentKind} via {ShellKind} / {Workspace.Name}";

        public override string ToString()
        {
            return $"{Id}  {DisplayName}";
        }
    }
}
