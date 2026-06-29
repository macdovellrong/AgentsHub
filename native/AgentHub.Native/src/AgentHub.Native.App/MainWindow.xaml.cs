using System.Diagnostics;
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
    private readonly AgentStartupPreflightChecker startupPreflightChecker = AgentStartupPreflightChecker.CreateDefault();
    private readonly Dictionary<string, SessionViewModel> sessions = new(StringComparer.OrdinalIgnoreCase);
    private readonly CollaborationEventStore collaborationEventStore = new(ResolveCollaborationEventsDirectory());
    private readonly AgentTaskStore taskStore = new();
    private readonly AgentTaskPlanEventStore taskPlanEventStore = new();
    private readonly AgentTaskPlanStore taskPlanStore = new();
    private readonly AgentConversationStore conversationStore = new();
    private readonly AgentConversationControlService conversationControlService;
    private readonly AgentTaskPlanService taskPlanService;
    private readonly AgentConversationOrchestrator conversationOrchestrator;
    private readonly AgentHookProcessingPipeline hookProcessingPipeline;
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
        conversationControlService = new AgentConversationControlService(
            conversationStore,
            collaborationEventStore);
        conversationOrchestrator = new AgentConversationOrchestrator(
            conversationStore,
            collaborationEventStore,
            inputRouter,
            sessionRegistry);
        hookProcessingPipeline = new AgentHookProcessingPipeline(
            collaborationEventStore,
            new AgentHookEventProcessor(
                collaborationEventStore,
                new AgentHubCommandDispatcher(new AgentMessageRouter(inputRouter, sessionRegistry)),
                new AgentTeamStore(),
                taskStore,
                taskPlanEventStore),
            taskPlanService,
            conversationOrchestrator);
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

    private void OpenWorkspaceFolder_Click(object sender, RoutedEventArgs e)
    {
        var validation = WorkspaceDirectoryValidator.Validate(CurrentWorkspacePath());
        if (!validation.IsValid)
        {
            StatusTextBlock.Text = validation.ErrorMessage ?? "No workspace selected";
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = validation.Path!,
            UseShellExecute = true
        });
        StatusTextBlock.Text = $"Opened workspace folder: {validation.Path}";
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
            await ReloadConversationsAsync(workspace.Path);
            await ReloadTaskPlansAsync(workspace.Path);
            ReloadSessionList();
        }
    }

    private void CurrentWorkspaceSessionsOnlyCheckBox_Changed(object sender, RoutedEventArgs e)
    {
        if (SessionListBox is null)
        {
            return;
        }

        ReloadSessionList();
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
                var selectedPlanId = await Dispatcher.InvokeAsync(CurrentTaskPlanId);
                var selectedConversationId = await Dispatcher.InvokeAsync(CurrentConversationId);
                await ReloadTimelineAsync(hookEvent.Workspace);
                await ReloadConversationsAsync(hookEvent.Workspace, selectedConversationId);
                await ReloadSelectedConversationDetailsAsync(hookEvent.Workspace);
                await ReloadTaskPlansAsync(hookEvent.Workspace, selectedPlanId);
                await ReloadSelectedTaskPlanDetailsAsync(hookEvent.Workspace);
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
        return await hookProcessingPipeline.ProcessAsync(hookEvent);
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

    private async void StartManagedAgents_Click(object sender, RoutedEventArgs e)
    {
        var commands = AgentStartupCommandCatalog.BuildManagedAgentStartCommands();
        var startedCount = await StartAgentBatchAsync(commands);
        StatusTextBlock.Text = $"Started managed agents: {startedCount}/{commands.Count}";
    }

    private async void ResumeManagedAgents_Click(object sender, RoutedEventArgs e)
    {
        var commands = AgentStartupCommandCatalog.BuildManagedAgentResumeCommands();
        var startedCount = await StartAgentBatchAsync(commands);
        StatusTextBlock.Text = $"Resumed managed agents: {startedCount}/{commands.Count}";
    }

    private async void StopManagedAgents_Click(object sender, RoutedEventArgs e)
    {
        var targetSessions = sessions.Values
            .Where(session =>
                AgentStartupCommandCatalog.IsManagedAgent(session.AgentKind) &&
                IsCurrentWorkspace(session.Workspace.Path))
            .ToArray();

        var stoppedCount = 0;
        foreach (var session in targetSessions)
        {
            if (await inputRouter.TryStopAsync(session.Id))
            {
                stoppedCount++;
            }

            RemoveSessionView(session.Id);
        }

        StatusTextBlock.Text = $"Stopped managed agents: {stoppedCount}";
    }

    private async void InterruptManagedAgents_Click(object sender, RoutedEventArgs e)
    {
        var targetSessions = sessions.Values
            .Where(session =>
                AgentStartupCommandCatalog.IsManagedAgent(session.AgentKind) &&
                IsCurrentWorkspace(session.Workspace.Path))
            .ToArray();

        var interruptedCount = 0;
        foreach (var session in targetSessions)
        {
            var result = await inputRouter.TrySendControlDetailedAsync(session.Id, "\x03");
            if (result.Sent)
            {
                interruptedCount++;
                continue;
            }

            if (result.ShouldRemoveSession)
            {
                RemoveSessionView(session.Id);
            }
        }

        StatusTextBlock.Text = $"Interrupted managed agents: {interruptedCount}/{targetSessions.Length}";
    }

    private async Task<int> StartAgentBatchAsync(IReadOnlyList<AgentStartupCommand> commands)
    {
        var startedCount = 0;
        foreach (var command in commands)
        {
            if (await StartAgentAsync(command))
            {
                startedCount++;
            }
        }

        return startedCount;
    }

    private async void StartPowerShell_Click(object sender, RoutedEventArgs e)
    {
        await StartAgentAsync(AgentStartupCommandCatalog.Build(AgentKind.PowerShell, AgentStartupMode.Start));
    }

    private async void StartScrollTest_Click(object sender, RoutedEventArgs e)
    {
        await StartAgentAsync(AgentStartupCommandCatalog.Build(AgentKind.ScrollTest, AgentStartupMode.Start));
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

    private async void StartManagerConversation_Click(object sender, RoutedEventArgs e)
    {
        await StartConversationAsync("manager");
    }

    private async void StartRoundtableConversation_Click(object sender, RoutedEventArgs e)
    {
        await StartConversationAsync("roundtable");
    }

    private async void StartPairNegotiationConversation_Click(object sender, RoutedEventArgs e)
    {
        await StartConversationAsync("pair");
    }

    private async Task StartConversationAsync(string mode)
    {
        var workspacePath = CurrentRoutingWorkspacePath();
        if (workspacePath is null)
        {
            StatusTextBlock.Text = "No workspace selected";
            return;
        }

        var topic = ConversationTopicTextBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(topic))
        {
            StatusTextBlock.Text = "Conversation topic required";
            return;
        }

        var participants = ParseConversationParticipants(ConversationParticipantsTextBox.Text);
        if (participants.Count == 0)
        {
            StatusTextBlock.Text = "Conversation participants required";
            return;
        }

        try
        {
            var conversation = mode switch
            {
                "manager" => await conversationOrchestrator.StartManagerAsync(new StartAgentManagerConversationRequest(
                    workspacePath,
                    topic,
                    ResolveManagerParticipants(participants),
                    SupervisorProfileId: "claude")),
                "roundtable" => await conversationOrchestrator.StartRoundtableAsync(new StartRoundtableConversationRequest(
                    workspacePath,
                    topic,
                    participants)),
                "pair" => participants.Count == 2
                    ? await conversationOrchestrator.StartPairNegotiationAsync(new StartPairNegotiationConversationRequest(
                        workspacePath,
                        topic,
                        participants))
                    : throw new InvalidOperationException("Pair negotiation requires exactly two participants."),
                _ => throw new InvalidOperationException($"Unknown conversation mode: {mode}")
            };
            await ReloadTimelineAsync(workspacePath);
            await ReloadConversationsAsync(workspacePath, conversation.Id);
            await ReloadSelectedConversationDetailsAsync(workspacePath);
            StatusTextBlock.Text = conversation.Status == "running"
                ? $"Started {conversation.Mode}: {conversation.Id}"
                : $"{conversation.Mode} not started: {conversation.Status}";
        }
        catch (Exception ex)
        {
            StatusTextBlock.Text = $"Start conversation failed: {ex.Message}";
        }
    }

    private async void RefreshConversations_Click(object sender, RoutedEventArgs e)
    {
        var workspacePath = CurrentRoutingWorkspacePath();
        if (workspacePath is null)
        {
            StatusTextBlock.Text = "No workspace selected";
            return;
        }

        await ReloadConversationsAsync(workspacePath, CurrentConversationId());
        await ReloadSelectedConversationDetailsAsync(workspacePath);
        StatusTextBlock.Text = "Conversations refreshed";
    }

    private async void ConversationListBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        await ReloadSelectedConversationDetailsAsync();
    }

    private void OpenConversationFolder_Click(object sender, RoutedEventArgs e)
    {
        var workspacePath = CurrentRoutingWorkspacePath();
        if (workspacePath is null)
        {
            StatusTextBlock.Text = "No workspace selected";
            return;
        }

        if (ConversationListBox.SelectedItem is not ConversationViewModel selected)
        {
            StatusTextBlock.Text = "No conversation selected";
            return;
        }

        var folderPath = ResolveConversationFolderPath(workspacePath, selected.Conversation.Id);
        if (!Directory.Exists(folderPath))
        {
            StatusTextBlock.Text = $"Conversation folder not found: {selected.Conversation.Id}";
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = folderPath,
            UseShellExecute = true
        });
        StatusTextBlock.Text = $"Opened conversation folder: {selected.Conversation.Id}";
    }

    private async void PauseConversation_Click(object sender, RoutedEventArgs e)
    {
        await ChangeSelectedConversationStatusAsync(
            "pause",
            (workspacePath, conversationId) => conversationControlService.PauseAsync(
                workspacePath,
                conversationId,
                "Paused from AgentHub Native"));
    }

    private async void ResumeConversation_Click(object sender, RoutedEventArgs e)
    {
        await ChangeSelectedConversationStatusAsync(
            "resume",
            (workspacePath, conversationId) => conversationControlService.ResumeAsync(
                workspacePath,
                conversationId,
                "Resumed from AgentHub Native"));
    }

    private async void StopConversation_Click(object sender, RoutedEventArgs e)
    {
        await ChangeSelectedConversationStatusAsync(
            "stop",
            (workspacePath, conversationId) => conversationControlService.StopAsync(
                workspacePath,
                conversationId,
                "Stopped from AgentHub Native"));
    }

    private async Task ChangeSelectedConversationStatusAsync(
        string action,
        Func<string, string, Task<AgentConversation>> updateAsync)
    {
        var workspacePath = CurrentRoutingWorkspacePath();
        if (workspacePath is null)
        {
            StatusTextBlock.Text = "No workspace selected";
            return;
        }

        if (ConversationListBox.SelectedItem is not ConversationViewModel selected)
        {
            StatusTextBlock.Text = "No conversation selected";
            return;
        }

        try
        {
            var updated = await updateAsync(workspacePath, selected.Conversation.Id);
            await ReloadConversationsAsync(workspacePath, updated.Id);
            await ReloadSelectedConversationDetailsAsync(workspacePath);
            await ReloadTimelineAsync(workspacePath);
            StatusTextBlock.Text = $"Conversation {action}: {updated.Id}";
        }
        catch (Exception ex)
        {
            StatusTextBlock.Text = $"Conversation {action} failed: {ex.Message}";
        }
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
            await ReloadSelectedTaskPlanDetailsAsync(workspacePath);
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

    private async void PauseTaskPlan_Click(object sender, RoutedEventArgs e)
    {
        await ChangeSelectedTaskPlanStatusAsync(
            "pause",
            (workspacePath, planId) => taskPlanService.PausePlanAsync(
                workspacePath,
                planId,
                "Paused from AgentHub Native"));
    }

    private async void ResumeTaskPlan_Click(object sender, RoutedEventArgs e)
    {
        await ChangeSelectedTaskPlanStatusAsync(
            "resume",
            (workspacePath, planId) => taskPlanService.ResumePlanAsync(
                workspacePath,
                planId,
                "Resumed from AgentHub Native"));
    }

    private async void ArchiveTaskPlan_Click(object sender, RoutedEventArgs e)
    {
        await ChangeSelectedTaskPlanStatusAsync(
            "archive",
            (workspacePath, planId) => taskPlanService.ArchivePlanAsync(
                workspacePath,
                planId,
                "Archived from AgentHub Native"));
    }

    private async Task ChangeSelectedTaskPlanStatusAsync(
        string action,
        Func<string, string, Task<AgentTaskPlan>> updateAsync)
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
            var updated = await updateAsync(workspacePath, selected.Plan.Id);
            await ReloadTaskPlansAsync(workspacePath, updated.Id);
            await ReloadSelectedTaskPlanDetailsAsync(workspacePath);
            await ReloadTimelineAsync(workspacePath);
            StatusTextBlock.Text = $"Task plan {action}: {updated.Title}";
        }
        catch (Exception ex)
        {
            StatusTextBlock.Text = $"Task plan {action} failed: {ex.Message}";
        }
    }

    private void OpenTaskPlanFolder_Click(object sender, RoutedEventArgs e)
    {
        if (TaskPlanListBox.SelectedItem is not TaskPlanViewModel selected)
        {
            StatusTextBlock.Text = "No task plan selected";
            return;
        }

        var folderPath = selected.Plan.PlanPath;
        if (!Directory.Exists(folderPath))
        {
            StatusTextBlock.Text = $"Task plan folder not found: {selected.Plan.Id}";
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = folderPath,
            UseShellExecute = true
        });
        StatusTextBlock.Text = $"Opened task plan folder: {selected.Plan.Title}";
    }

    private void OpenNativeDataFolder_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var folderPath = NativeDiagnosticsPaths.ResolveDataDirectory();
            Directory.CreateDirectory(folderPath);
            Process.Start(new ProcessStartInfo
            {
                FileName = folderPath,
                UseShellExecute = true
            });
            StatusTextBlock.Text = "Opened native data folder";
        }
        catch (Exception ex)
        {
            StatusTextBlock.Text = $"Open native data folder failed: {ex.Message}";
        }
    }

    private async void RunNativeDiagnostics_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            StatusTextBlock.Text = "Running diagnostics...";
            var workspaceValidation = WorkspaceDirectoryValidator.Validate(CurrentWorkspacePath());
            var workspacePath = workspaceValidation.IsValid ? workspaceValidation.Path : null;
            var result = await NativeDiagnosticsLauncher.RunAsync(
                ResolveNativeDataDirectory(),
                workspacePath,
                ResolveHookPythonCommand());
            StatusTextBlock.Text = result.ExitCode == 0
                ? $"Diagnostics written: {result.OutputPath}"
                : $"Diagnostics failed ({result.ExitCode}): {FirstNonEmptyLine(result.StandardError, result.StandardOutput)}";
        }
        catch (Exception ex)
        {
            StatusTextBlock.Text = $"Run diagnostics failed: {ex.Message}";
        }
    }

    private void WriteNativeValidationReport_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var dataDirectory = ResolveNativeDataDirectory();
            var workspaceValidation = WorkspaceDirectoryValidator.Validate(CurrentWorkspacePath());
            var workspacePath = workspaceValidation.IsValid
                ? workspaceValidation.Path
                : CurrentWorkspacePath();
            var outputPath = NativeManualValidationReportWriter.WriteTemplate(
                dataDirectory,
                new NativeManualValidationReportRequest(
                    workspacePath,
                    NativeDiagnosticsLauncher.ResolveLatestReportPointerPath(dataDirectory),
                    Path.Combine(dataDirectory, "diagnostics", "latest-laptop-validation.txt"),
                    ResolveHookLogPath(),
                    sessions.Values
                        .OrderBy(session => session.Descriptor.StartedAt)
                        .Select(session => AgentSessionDisplayFormatter.Format(session.Descriptor))
                        .ToArray()));
            StatusTextBlock.Text = $"Validation checklist written: {outputPath}";
        }
        catch (Exception ex)
        {
            StatusTextBlock.Text = $"Write validation checklist failed: {ex.Message}";
        }
    }

    private static string FirstNonEmptyLine(params string[] values)
    {
        foreach (var value in values)
        {
            var line = value
                .Split(["\r\n", "\n"], StringSplitOptions.None)
                .FirstOrDefault(line => !string.IsNullOrWhiteSpace(line));
            if (!string.IsNullOrWhiteSpace(line))
            {
                return line.Trim();
            }
        }

        return "no details";
    }

    private async void TaskPlanListBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        await ReloadSelectedTaskPlanDetailsAsync();
    }

    private async Task<bool> StartAgentAsync(AgentStartupCommand startupCommand)
    {
        try
        {
            var workspace = await AddCurrentWorkspaceAsync();
            if (workspace is null)
            {
                StatusTextBlock.Text = WorkspaceStatusResolver.ResolveMissingWorkspaceStatus(
                    StatusTextBlock.Text,
                    "Select or add a workspace first");
                return false;
            }

            var isManagedAgent = AgentStartupCommandCatalog.IsManagedAgent(startupCommand.AgentKind);
            var hookScriptsDirectory = isManagedAgent
                ? TryResolveHookScriptsDirectory()
                : null;
            var hookPythonCommand = isManagedAgent
                ? ResolveHookPythonCommand()
                : null;
            var preflightResult = startupPreflightChecker.Check(new AgentStartupPreflightRequest(
                startupCommand,
                hookScriptsDirectory,
                hookPythonCommand));
            preflightResult.ThrowIfFailed();

            if (isManagedAgent)
            {
                StatusTextBlock.Text = "Installing project hooks...";
                await ProjectAgentHookInstaller.InstallAsync(
                    workspace.Path,
                    new ProjectAgentHookInstallerOptions(hookScriptsDirectory!, hookPythonCommand!));
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
            ReloadSessionList(sessionId);
            StatusTextBlock.Text = $"Started {session.DisplayName}";
            return true;
        }
        catch (Exception ex)
        {
            StatusTextBlock.Text = AgentStartupStatusFormatter.FormatFailure(startupCommand.AgentKind, ex);
            return false;
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
        return NativeDiagnosticsPaths.ResolveHookLogPath(ResolveNativeDataDirectory());
    }

    private static string ResolveNativeDataDirectory()
    {
        return NativeDiagnosticsPaths.ResolveDataDirectory();
    }

    private static string? TryResolveHookScriptsDirectory()
    {
        var environmentOverride = Environment.GetEnvironmentVariable("AGENTHUB_HOOKS_SOURCE_DIR");
        var candidates = new List<string>();
        if (!string.IsNullOrWhiteSpace(environmentOverride))
        {
            return environmentOverride;
        }

        AddAncestorCandidates(candidates, Directory.GetCurrentDirectory());
        AddAncestorCandidates(candidates, AppContext.BaseDirectory);
        foreach (var candidate in candidates)
        {
            if (Directory.Exists(candidate))
            {
                return candidate;
            }
        }

        return null;
    }

    private string ResolveHookPythonCommand()
    {
        return NativeHookPythonCommandResolver.Resolve(startupOptions.HookPythonCommand);
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
        ClearSelectedSessionView();
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
        var profileIds = AgentProfileTargetResolver.Resolve(targetProfileId);
        var sentCount = 0;
        AgentMessageSendResult? firstFailedResult = null;
        foreach (var profileId in profileIds)
        {
            var result = await messageRouter.TrySendToProfileDetailedAsync(workspacePath, profileId, text);
            if (result.Sent)
            {
                sentCount++;
                continue;
            }

            firstFailedResult ??= result;
        }

        if (sentCount == 0)
        {
            if (firstFailedResult?.Status == AgentMessageSendStatus.TerminalNotReady)
            {
                StatusTextBlock.Text = profileIds.Count == 1
                    ? $"{profileIds[0]} is still starting"
                    : $"Target profiles are still starting: {string.Join(", ", profileIds)}";
            }
            else
            {
                StatusTextBlock.Text = profileIds.Count == 1
                    ? $"{profileIds[0]} is not online"
                    : $"No target profiles are online: {string.Join(", ", profileIds)}";
            }

            return false;
        }

        await RecordUserMessageAsync(workspacePath, targetProfileId, text);
        StatusTextBlock.Text = profileIds.Count == 1
            ? $"Sent input to latest {profileIds[0]}"
            : $"Sent input to {sentCount}/{profileIds.Count} profile(s)";
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

    private async Task ReloadConversationsAsync(string workspacePath, string? selectedConversationId = null)
    {
        var conversations = await conversationStore.ListAsync(workspacePath);
        await Dispatcher.InvokeAsync(() =>
        {
            var retainedSelection = selectedConversationId ?? CurrentConversationId();
            ConversationListBox.Items.Clear();
            ConversationViewModel? selected = null;
            foreach (var conversation in conversations.OrderByDescending(item => item.UpdatedAt).Take(100))
            {
                var item = new ConversationViewModel(conversation);
                ConversationListBox.Items.Add(item);
                if (string.Equals(conversation.Id, retainedSelection, StringComparison.Ordinal))
                {
                    selected = item;
                }
            }

            if (selected is not null)
            {
                ConversationListBox.SelectedItem = selected;
            }
            else if (ConversationListBox.Items.Count > 0 && ConversationListBox.SelectedItem is null)
            {
                ConversationListBox.SelectedIndex = 0;
            }
            else if (ConversationListBox.Items.Count == 0)
            {
                ConversationDetailListBox.Items.Clear();
            }
        });
    }

    private async Task ReloadSelectedConversationDetailsAsync(string? workspacePath = null)
    {
        var resolvedWorkspacePath = workspacePath ?? await Dispatcher.InvokeAsync(CurrentRoutingWorkspacePath);
        var selected = await Dispatcher.InvokeAsync(() =>
            ConversationListBox.SelectedItem as ConversationViewModel);
        if (resolvedWorkspacePath is null || selected is null)
        {
            await ClearConversationDetailsAsync();
            return;
        }

        var folderPath = ResolveConversationFolderPath(resolvedWorkspacePath, selected.Conversation.Id);
        await Dispatcher.InvokeAsync(() =>
        {
            ConversationDetailListBox.Items.Clear();
            foreach (var detail in AgentConversationDisplayFormatter.FormatDetails(selected.Conversation, folderPath))
            {
                ConversationDetailListBox.Items.Add(detail);
            }
        });
    }

    private async Task ClearConversationDetailsAsync()
    {
        await Dispatcher.InvokeAsync(() =>
        {
            ConversationDetailListBox.Items.Clear();
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

    private async Task ReloadSelectedTaskPlanDetailsAsync(string? workspacePath = null)
    {
        var resolvedWorkspacePath = workspacePath ?? await Dispatcher.InvokeAsync(CurrentRoutingWorkspacePath);
        var selectedPlanId = await Dispatcher.InvokeAsync(() =>
            TaskPlanListBox.SelectedItem is TaskPlanViewModel selected ? selected.Plan.Id : null);
        if (resolvedWorkspacePath is null || selectedPlanId is null)
        {
            await ClearTaskPlanDetailsAsync();
            return;
        }

        var tasks = await taskPlanStore.ListTasksAsync(resolvedWorkspacePath, selectedPlanId);
        var events = await taskPlanStore.ListEventsAsync(resolvedWorkspacePath, selectedPlanId);
        await Dispatcher.InvokeAsync(() =>
        {
            TaskPlanTaskListBox.Items.Clear();
            foreach (var task in tasks.OrderBy(task => task.Id, StringComparer.Ordinal))
            {
                TaskPlanTaskListBox.Items.Add(TaskPlanDisplayFormatter.FormatTask(task));
            }

            TaskPlanEventListBox.Items.Clear();
            foreach (var item in events.OrderByDescending(item => item.Timestamp).Take(100))
            {
                TaskPlanEventListBox.Items.Add(TaskPlanDisplayFormatter.FormatEvent(item, TimeZoneInfo.Local));
            }
        });
    }

    private async Task ClearTaskPlanDetailsAsync()
    {
        await Dispatcher.InvokeAsync(() =>
        {
            TaskPlanTaskListBox.Items.Clear();
            TaskPlanEventListBox.Items.Clear();
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

    private static IReadOnlyList<string> ParseConversationParticipants(string text)
    {
        return text.Split([',', ';', '\r', '\n', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static IReadOnlyList<string> ResolveManagerParticipants(IReadOnlyList<string> participants)
    {
        var workers = participants
            .Where(profileId => !string.Equals(profileId, "claude", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        return workers.Length == 0 ? ["codex"] : workers;
    }

    private string? CurrentTaskPlanId()
    {
        return TaskPlanListBox.SelectedItem is TaskPlanViewModel selected ? selected.Plan.Id : null;
    }

    private string? CurrentConversationId()
    {
        return ConversationListBox.SelectedItem is ConversationViewModel selected ? selected.Conversation.Id : null;
    }

    private static string ResolveConversationFolderPath(string workspacePath, string conversationId)
    {
        return Path.Combine(workspacePath, ".agenthub", "conversations", conversationId);
    }

    private async Task RecordUserMessageAsync(string workspacePath, string targetProfileId, string text)
    {
        var conversationId = await Dispatcher.InvokeAsync(CurrentConversationId);
        var planId = await Dispatcher.InvokeAsync(CurrentTaskPlanId);
        await collaborationEventStore.AppendUserMessageAsync(ManualUserMessageFactory.Create(
            workspacePath,
            targetProfileId,
            text,
            conversationId,
            planId));
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
        FocusTerminal(session);
    }

    private static void FocusTerminal(SessionViewModel session)
    {
        session.Terminal.Focus();
        Keyboard.Focus(session.Terminal);
    }

    private void ReloadSessionList(string? selectSessionId = null)
    {
        var retainedSessionId = selectSessionId ?? selectedSessionId;
        var visibleSessions = SessionListFilter.Filter(
                sessions.Values.OrderBy(session => session.Descriptor.StartedAt),
                CurrentRoutingWorkspacePath(),
                CurrentWorkspaceSessionsOnlyCheckBox.IsChecked == true,
                session => session.Workspace.Path)
            .ToArray();

        SessionListBox.Items.Clear();
        SessionViewModel? selected = null;
        foreach (var session in visibleSessions)
        {
            SessionListBox.Items.Add(session);
            if (string.Equals(session.Id, retainedSessionId, StringComparison.OrdinalIgnoreCase))
            {
                selected = session;
            }
        }

        selected ??= visibleSessions.FirstOrDefault();
        if (selected is not null)
        {
            SessionListBox.SelectedItem = selected;
            return;
        }

        ClearSelectedSessionView();
    }

    private void ClearSelectedSessionView()
    {
        selectedSessionId = null;
        TerminalHostGrid.Children.Clear();
        CurrentSessionTextBlock.Text = "No session";
    }

    private void RemoveSessionView(string sessionId)
    {
        sessionRegistry.Remove(sessionId);
        sessions.Remove(sessionId);

        if (string.Equals(selectedSessionId, sessionId, StringComparison.OrdinalIgnoreCase))
        {
            ClearSelectedSessionView();
        }

        ReloadSessionList();
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

    private sealed record ConversationViewModel(AgentConversation Conversation)
    {
        public override string ToString()
        {
            return AgentConversationDisplayFormatter.Format(Conversation);
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
