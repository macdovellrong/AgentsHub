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
using AgentHub.Native.Core.Settings;
using AgentHub.Native.Core.TaskPlans;
using AgentHub.Native.Core.Workspaces;
using EasyWindowsTerminalControl;

namespace AgentHub.Native.App;

public partial class MainWindow : Window
{
    private readonly AgentInputRouter inputRouter = new();
    private readonly AgentSessionRegistry sessionRegistry = new();
    private readonly Dictionary<string, SessionViewModel> sessions = new(StringComparer.OrdinalIgnoreCase);
    private readonly CollaborationEventStore collaborationEventStore = new(ResolveCollaborationEventsDirectory());
    private readonly AgentTaskStore taskStore = new();
    private readonly AgentTaskPlanEventStore taskPlanEventStore = new();
    private readonly AgentTaskPlanStore taskPlanStore = new();
    private readonly AgentTaskPlanService taskPlanService;
    private readonly NativeAppSettingsStore settingsStore = new(ResolveSettingsPath());
    private readonly WorkspaceStore workspaceStore = new(ResolveWorkspaceStorePath());
    private readonly NativeAppStartupOptions startupOptions;
    private int nextSessionNumber = 1;
    private string? selectedSessionId;
    private AgentHookReceiver? hookReceiver;
    private AgentHookReceiverInfo? hookInfo;

    public MainWindow()
        : this(NativeAppStartupOptions.Empty)
    {
    }

    public MainWindow(NativeAppStartupOptions startupOptions)
    {
        this.startupOptions = startupOptions;
        taskPlanService = new AgentTaskPlanService(
            taskPlanStore,
            collaborationEventStore,
            inputRouter,
            sessionRegistry);
        InitializeComponent();
        Loaded += MainWindow_Loaded;
        Closed += MainWindow_Closed;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        await LoadSettingsAsync();
        HostShellComboBox.SelectionChanged += HostShellComboBox_SelectionChanged;
        hookReceiver = new AgentHookReceiver(new AgentHookReceiverOptions(0, Guid.NewGuid().ToString("N")));
        hookReceiver.EventReceived += HookReceiver_EventReceived;
        hookInfo = await hookReceiver.StartAsync();
        StatusTextBlock.Text = $"Hook receiver: {hookInfo.Url}";
        await LoadStartupWorkspaceAsync();
        await StartStartupAgentAsync();
    }

    private async Task LoadSettingsAsync()
    {
        var settings = await settingsStore.LoadAsync();
        SelectHostShell(startupOptions.HostShell ?? settings.HostShell);
    }

    private async void HostShellComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        try
        {
            await settingsStore.SaveAsync(new NativeAppSettings(SelectedShellKind()));
            StatusTextBlock.Text = $"Host shell: {SelectedShellKind()}";
        }
        catch (Exception ex)
        {
            StatusTextBlock.Text = $"Save settings failed: {ex.Message}";
        }
    }

    private void MainWindow_Closed(object? sender, EventArgs e)
    {
        try
        {
            inputRouter.StopAllAsync().GetAwaiter().GetResult();
        }
        finally
        {
            if (hookReceiver is not null)
            {
                hookReceiver.DisposeAsync().AsTask().GetAwaiter().GetResult();
            }
        }
    }

    private async void AddWorkspace_Click(object sender, RoutedEventArgs e)
    {
        await AddCurrentWorkspaceAsync();
    }

    private async void BrowseWorkspace_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new Microsoft.Win32.OpenFolderDialog
        {
            Title = "Select workspace"
        };
        var currentPath = CurrentWorkspacePath();
        if (currentPath is not null && Directory.Exists(currentPath))
        {
            dialog.InitialDirectory = currentPath;
        }

        if (dialog.ShowDialog(this) != true)
        {
            return;
        }

        var selectedPath = WorkspacePathSelection.NormalizeSelectedPath(dialog.FolderName);
        if (selectedPath is null)
        {
            return;
        }

        WorkspaceTextBox.Text = selectedPath;
        var workspace = await AddCurrentWorkspaceAsync();
        StatusTextBlock.Text = workspace is null
            ? WorkspaceStatusResolver.ResolveMissingWorkspaceStatus(StatusTextBlock.Text, "No workspace selected")
            : $"Workspace selected: {workspace.Name}";
    }

    private async void RemoveWorkspace_Click(object sender, RoutedEventArgs e)
    {
        var selectedPath = WorkspaceListBox.SelectedItem is WorkspaceEntry workspace ? workspace.Path : null;
        var workspacePath = WorkspacePathSelection.ResolveRemovalPath(WorkspaceTextBox.Text, selectedPath);
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
            await ReloadTaskPlansAsync(workspace.Path);
        }
    }

    private async void HookReceiver_EventReceived(object? sender, AgentHookEvent hookEvent)
    {
        try
        {
            var dispatchResult = await ProcessHookEventAsync(hookEvent);
            await Dispatcher.InvokeAsync(() =>
            {
                var profile = hookEvent.ProfileId ?? hookEvent.Source ?? "agent";
                StatusTextBlock.Text = dispatchResult.SentCount > 0
                    ? $"Hook received: {profile}; routed {dispatchResult.SentCount} command(s)"
                    : $"Hook received: {profile}";
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

    private async Task<AgentHubCommandDispatchResult> ProcessHookEventAsync(AgentHookEvent hookEvent)
    {
        var processor = new AgentHookEventProcessor(
            collaborationEventStore,
            new AgentHubCommandDispatcher(new AgentMessageRouter(inputRouter, sessionRegistry)),
            new AgentTeamStore(),
            taskStore,
            taskPlanEventStore);
        var result = await processor.ProcessAsync(hookEvent);
        await taskPlanService.RecordManagerDispatchResultAsync(
            hookEvent.Workspace,
            hookEvent.ProfileId ?? hookEvent.Source ?? "agent",
            result);
        return result;
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

    private async void RefreshTaskPlans_Click(object sender, RoutedEventArgs e)
    {
        var workspacePath = CurrentRoutingWorkspacePath();
        if (workspacePath is null)
        {
            StatusTextBlock.Text = "No workspace selected";
            return;
        }

        await ReloadTaskPlansAsync(workspacePath);
        StatusTextBlock.Text = "Task plans refreshed";
    }

    private void TaskPlanSourceComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (TaskPlanSourceComboBox.SelectedItem is not TaskPlanSourceViewModel source)
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(TaskPlanTitleTextBox.Text))
        {
            TaskPlanTitleTextBox.Text = source.Source.Title;
        }
    }

    private async void CreateTaskPlan_Click(object sender, RoutedEventArgs e)
    {
        var workspacePath = CurrentRoutingWorkspacePath();
        if (workspacePath is null)
        {
            StatusTextBlock.Text = "No workspace selected";
            return;
        }

        if (TaskPlanSourceComboBox.SelectedItem is not TaskPlanSourceViewModel source)
        {
            StatusTextBlock.Text = "No task-plan source selected";
            return;
        }

        try
        {
            var title = string.IsNullOrWhiteSpace(TaskPlanTitleTextBox.Text)
                ? source.Source.Title
                : TaskPlanTitleTextBox.Text.Trim();
            var plan = await taskPlanService.CreatePlanAsync(
                workspacePath,
                new CreateAgentTaskPlanRequest(
                    title,
                    source.Source.DirectoryName,
                    "claude",
                    ["codex", "gemini"]));
            await ReloadTaskPlansAsync(workspacePath, plan.Id);
            StatusTextBlock.Text = $"Task plan created: {plan.Title}";
        }
        catch (Exception ex)
        {
            StatusTextBlock.Text = $"Create task plan failed: {ex.Message}";
        }
    }

    private async void StartTaskPlanManager_Click(object sender, RoutedEventArgs e)
    {
        var workspacePath = CurrentRoutingWorkspacePath();
        if (workspacePath is null)
        {
            StatusTextBlock.Text = "No workspace selected";
            return;
        }

        if (TaskPlanListBox.SelectedItem is not TaskPlanViewModel selected)
        {
            StatusTextBlock.Text = "No task plan selected";
            return;
        }

        try
        {
            var updated = await taskPlanService.StartManagerAsync(workspacePath, selected.Plan.Id);
            await ReloadTaskPlansAsync(workspacePath, updated.Id);
            await ReloadTimelineAsync(workspacePath);
            StatusTextBlock.Text = updated.Status == "running"
                ? $"Task plan manager started: {updated.Title}"
                : $"Task plan manager not started: {updated.Title}";
        }
        catch (Exception ex)
        {
            StatusTextBlock.Text = $"Start task plan manager failed: {ex.Message}";
        }
    }

    private async Task StartAgentAsync(AgentStartupCommand startupCommand)
    {
        try
        {
            var workspace = await AddCurrentWorkspaceAsync();
            if (workspace is null)
            {
                StatusTextBlock.Text = WorkspaceStatusResolver.ResolveMissingWorkspaceStatus(
                    StatusTextBlock.Text,
                    "Select or add a workspace first");
                return;
            }

            if (startupCommand.AgentKind != AgentKind.PowerShell)
            {
                StatusTextBlock.Text = "Installing project hooks...";
                await ProjectAgentHookInstaller.InstallAsync(
                    workspace.Path,
                    new ProjectAgentHookInstallerOptions(ResolveHookScriptsDirectory(), ResolveHookPythonCommand()));
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
                    workspace.Path,
                    ResolveHookLogPath()));
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

            var descriptor = new AgentSessionDescriptor(
                sessionId,
                profileId,
                workspace.Path,
                DateTimeOffset.UtcNow,
                runId,
                hookInfo?.Url);
            var session = new SessionViewModel(
                descriptor,
                startupCommand.AgentKind,
                shellKind,
                workspace,
                terminal);
            sessions[sessionId] = session;
            inputRouter.Register(new NativeTerminalSessionAdapter(sessionId, terminal));
            sessionRegistry.Register(descriptor);
            SessionListBox.Items.Add(session);
            SessionListBox.SelectedItem = session;
            StatusTextBlock.Text = $"Started {session.DisplayName}";
        }
        catch (Exception ex)
        {
            StatusTextBlock.Text = AgentStartupStatusFormatter.FormatFailure(startupCommand.AgentKind, ex);
        }
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

    private void SelectHostShell(ShellKind shellKind)
    {
        var expected = shellKind == ShellKind.Cmd ? "cmd" : "PowerShell";
        foreach (var item in HostShellComboBox.Items.OfType<ComboBoxItem>())
        {
            if (string.Equals(item.Content?.ToString(), expected, StringComparison.OrdinalIgnoreCase))
            {
                HostShellComboBox.SelectedItem = item;
                return;
            }
        }

        HostShellComboBox.SelectedIndex = 0;
    }

    private async Task LoadStartupWorkspaceAsync()
    {
        if (startupOptions.InitialWorkspacePath is null)
        {
            await ReloadWorkspacesAsync();
            return;
        }

        WorkspaceTextBox.Text = startupOptions.InitialWorkspacePath;
        var validation = WorkspaceDirectoryValidator.Validate(startupOptions.InitialWorkspacePath);
        if (!validation.IsValid)
        {
            await ReloadWorkspacesAsync();
            StatusTextBlock.Text = validation.ErrorMessage ?? "Invalid startup workspace";
            return;
        }

        var workspace = await workspaceStore.AddOrUpdateAsync(validation.Path!);
        await ReloadWorkspacesAsync(workspace.Path);
        StatusTextBlock.Text = $"Workspace selected: {workspace.Name}";
    }

    private async Task StartStartupAgentAsync()
    {
        if (startupOptions.StartupAgents.Count == 0)
        {
            return;
        }

        foreach (var startupAgent in startupOptions.StartupAgents)
        {
            await StartAgentAsync(AgentStartupCommandCatalog.Build(
                startupAgent.AgentKind,
                startupAgent.Mode));
        }
    }

    private async Task<WorkspaceEntry?> AddCurrentWorkspaceAsync()
    {
        var validation = WorkspaceDirectoryValidator.Validate(CurrentWorkspacePath());
        if (!validation.IsValid)
        {
            StatusTextBlock.Text = validation.ErrorMessage ?? "Invalid workspace directory";
            return null;
        }

        var workspace = await workspaceStore.AddOrUpdateAsync(validation.Path!);
        await ReloadWorkspacesAsync(workspace.Path);
        return workspace;
    }

    private string? CurrentWorkspacePath()
    {
        var selectedPath = WorkspaceListBox.SelectedItem is WorkspaceEntry workspace ? workspace.Path : null;
        return WorkspacePathSelection.ResolveCurrentPath(WorkspaceTextBox.Text, selectedPath);
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

    private static string ResolveSettingsPath()
    {
        return Path.Combine(ResolveNativeDataDirectory(), "settings.json");
    }

    private static string ResolveCollaborationEventsDirectory()
    {
        return Path.Combine(ResolveNativeDataDirectory(), "events");
    }

    private static string ResolveHookLogPath()
    {
        return Path.Combine(ResolveNativeDataDirectory(), "hooks.jsonl");
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

    private string ResolveHookPythonCommand()
    {
        return startupOptions.HookPythonCommand ?? "py -3";
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

    private async void InterruptSession_Click(object sender, RoutedEventArgs e)
    {
        if (SessionListBox.SelectedItem is not SessionViewModel session)
        {
            StatusTextBlock.Text = "No selected session";
            return;
        }

        var result = await inputRouter.TrySendControlDetailedAsync(session.Id, "\x03");
        if (result.Sent)
        {
            StatusTextBlock.Text = $"Interrupted {session.Id}";
            return;
        }

        if (result.Status == AgentInputSendStatus.TerminalNotReady)
        {
            StatusTextBlock.Text = $"{session.Id} is still starting";
            return;
        }

        if (result.ShouldRemoveSession)
        {
            RemoveSessionView(session.Id);
        }

        StatusTextBlock.Text = $"Removed stale session {session.Id}";
    }

    private async void StopSession_Click(object sender, RoutedEventArgs e)
    {
        if (SessionListBox.SelectedItem is not SessionViewModel session)
        {
            StatusTextBlock.Text = "No selected session";
            return;
        }

        var stopped = await inputRouter.TryStopAsync(session.Id);
        RemoveSessionView(session.Id);
        StatusTextBlock.Text = stopped ? $"Stopped {session.Id}" : $"Removed stale session {session.Id}";
    }

    private async void StopAllSessions_Click(object sender, RoutedEventArgs e)
    {
        var stoppedCount = await inputRouter.StopAllAsync();
        sessionRegistry.Clear();
        sessions.Clear();
        SessionListBox.Items.Clear();
        selectedSessionId = null;
        TerminalHostGrid.Children.Clear();
        CurrentSessionTextBlock.Text = "No session";
        StatusTextBlock.Text = $"Stopped {stoppedCount} sessions";
    }

    private async void InjectTextBox_KeyDown(object sender, KeyEventArgs e)
    {
        var action = InputSubmissionGesture.Resolve(
            e.Key == Key.Enter || e.Key == Key.Return,
            Keyboard.Modifiers.HasFlag(ModifierKeys.Shift));
        if (action == InputSubmissionAction.Ignore)
        {
            return;
        }

        if (action == InputSubmissionAction.InsertNewline)
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

        if (await SendTextToTargetAsync(text))
        {
            InjectTextBox.Clear();
        }
    }

    private async Task<bool> SendTextToTargetAsync(string text)
    {
        var addressedMessage = AgentAddressedMessageParser.Parse(text);
        if (addressedMessage is not null)
        {
            return await SendTextToProfileAsync(addressedMessage.ProfileId, addressedMessage.Message);
        }

        var selectedTarget = TargetProfileComboBox.SelectedItem is ComboBoxItem item
            ? item.Content?.ToString()
            : null;

        if (string.IsNullOrWhiteSpace(selectedTarget) || selectedTarget == "Selected session")
        {
            if (selectedSessionId is null)
            {
                StatusTextBlock.Text = "No selected session";
                return false;
            }

            var targetSessionId = selectedSessionId!;
            var result = await inputRouter.TrySendLineDetailedAsync(targetSessionId, text);
            if (!result.Sent)
            {
                if (result.Status == AgentInputSendStatus.TerminalNotReady)
                {
                    StatusTextBlock.Text = $"{targetSessionId} is still starting";
                    return false;
                }

                if (result.ShouldRemoveSession)
                {
                    RemoveSessionView(targetSessionId);
                }

                StatusTextBlock.Text = $"Removed stale session {targetSessionId}";
                return false;
            }

            var selectedWorkspacePath = sessions.TryGetValue(targetSessionId, out var selectedSession)
                ? selectedSession.Workspace.Path
                : CurrentWorkspacePath();
            if (selectedWorkspacePath is not null)
            {
                await RecordUserMessageAsync(selectedWorkspacePath, targetSessionId, text);
            }

            StatusTextBlock.Text = $"Sent input to {targetSessionId}";
            return true;
        }

        var workspacePath = CurrentRoutingWorkspacePath();
        if (workspacePath is null)
        {
            StatusTextBlock.Text = "No workspace selected";
            return false;
        }

        return await SendTextToProfileAsync(selectedTarget, text);
    }

    private async Task<bool> SendTextToProfileAsync(string targetProfileId, string text)
    {
        var workspacePath = CurrentRoutingWorkspacePath();
        if (workspacePath is null)
        {
            StatusTextBlock.Text = "No workspace selected";
            return false;
        }

        var messageRouter = new AgentMessageRouter(inputRouter, sessionRegistry);
        var result = await messageRouter.TrySendToProfileDetailedAsync(workspacePath, targetProfileId, text);
        if (!result.Sent)
        {
            StatusTextBlock.Text = result.Status == AgentMessageSendStatus.TerminalNotReady
                ? $"{targetProfileId} is still starting"
                : $"{targetProfileId} is not online";
            return false;
        }

        await RecordUserMessageAsync(workspacePath, targetProfileId, text);
        StatusTextBlock.Text = $"Sent input to latest {targetProfileId}";
        return true;
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

    private async Task ReloadTaskPlansAsync(string workspacePath, string? selectedPlanId = null)
    {
        var sources = await taskPlanStore.ListSourceTasksAsync(workspacePath);
        var plans = await taskPlanStore.ListPlansAsync(workspacePath);
        await Dispatcher.InvokeAsync(() =>
        {
            TaskPlanSourceComboBox.Items.Clear();
            foreach (var source in sources)
            {
                TaskPlanSourceComboBox.Items.Add(new TaskPlanSourceViewModel(source));
            }

            if (TaskPlanSourceComboBox.Items.Count > 0 && TaskPlanSourceComboBox.SelectedItem is null)
            {
                TaskPlanSourceComboBox.SelectedIndex = 0;
            }

            TaskPlanListBox.Items.Clear();
            TaskPlanViewModel? selected = null;
            foreach (var plan in plans)
            {
                var item = new TaskPlanViewModel(plan);
                TaskPlanListBox.Items.Add(item);
                if (string.Equals(plan.Id, selectedPlanId, StringComparison.Ordinal))
                {
                    selected = item;
                }
            }

            if (selected is not null)
            {
                TaskPlanListBox.SelectedItem = selected;
            }
            else if (TaskPlanListBox.Items.Count > 0 && TaskPlanListBox.SelectedItem is null)
            {
                TaskPlanListBox.SelectedIndex = 0;
            }
        });
    }

    private bool IsCurrentWorkspace(string workspacePath)
    {
        var current = CurrentRoutingWorkspacePath();
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

    private string? CurrentRoutingWorkspacePath()
    {
        var selectedPath = WorkspaceListBox.SelectedItem is WorkspaceEntry workspace ? workspace.Path : null;
        return WorkspacePathSelection.ResolveRoutingPath(WorkspaceTextBox.Text, selectedPath);
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

    private void RemoveSessionView(string sessionId)
    {
        sessionRegistry.Remove(sessionId);
        sessions.Remove(sessionId);
        var item = SessionListBox.Items
            .OfType<SessionViewModel>()
            .FirstOrDefault(session => string.Equals(session.Id, sessionId, StringComparison.OrdinalIgnoreCase));
        if (item is not null)
        {
            SessionListBox.Items.Remove(item);
        }

        if (string.Equals(selectedSessionId, sessionId, StringComparison.OrdinalIgnoreCase))
        {
            selectedSessionId = null;
            TerminalHostGrid.Children.Clear();
            CurrentSessionTextBlock.Text = "No session";
        }
    }

    private sealed record SessionViewModel(
        AgentSessionDescriptor Descriptor,
        AgentKind AgentKind,
        ShellKind ShellKind,
        WorkspaceEntry Workspace,
        EasyTerminalControl Terminal)
    {
        public string Id => Descriptor.Id;

        public string DisplayName => AgentKind == AgentKind.PowerShell
            ? $"{ShellKind} / {Workspace.Name}"
            : $"{AgentKind} via {ShellKind} / {Workspace.Name}";

        public override string ToString()
        {
            return AgentSessionDisplayFormatter.Format(Descriptor);
        }
    }

    private sealed record TaskPlanSourceViewModel(AgentTaskPlanSource Source)
    {
        public override string ToString()
        {
            return $"{Source.DirectoryName} - {Source.Title}";
        }
    }

    private sealed record TaskPlanViewModel(AgentTaskPlan Plan)
    {
        public override string ToString()
        {
            return $"{Plan.Status} | {Plan.Title} | {Plan.Id}";
        }
    }
}
