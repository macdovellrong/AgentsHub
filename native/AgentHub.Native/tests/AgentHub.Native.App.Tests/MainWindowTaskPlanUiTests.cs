using System.IO;

namespace AgentHub.Native.App.Tests;

public sealed class MainWindowTaskPlanUiTests
{
    [Fact]
    public async Task Main_window_exposes_task_plan_controls()
    {
        var xaml = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml"));

        Assert.Contains("x:Name=\"TaskPlanSourceComboBox\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"TaskPlanTitleTextBox\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"TaskPlanListBox\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"TaskPlanTaskListBox\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"TaskPlanEventListBox\"", xaml, StringComparison.Ordinal);
        Assert.Contains("SelectionChanged=\"TaskPlanListBox_SelectionChanged\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"RefreshTaskPlans_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"CreateTaskPlan_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"StartTaskPlanManager_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"OpenTaskPlanFolder_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"PauseTaskPlan_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"ResumeTaskPlan_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"ArchiveTaskPlan_Click\"", xaml, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Main_window_wires_task_plan_service_to_controls()
    {
        var code = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml.cs"));

        Assert.Contains("AgentTaskPlanService", code, StringComparison.Ordinal);
        Assert.Contains("ReloadTaskPlansAsync", code, StringComparison.Ordinal);
        Assert.Contains("CreateTaskPlan_Click", code, StringComparison.Ordinal);
        Assert.Contains("StartTaskPlanManager_Click", code, StringComparison.Ordinal);
        Assert.Contains("StartManagerAsync", code, StringComparison.Ordinal);
        Assert.Contains("ReloadSelectedTaskPlanDetailsAsync", code, StringComparison.Ordinal);
        Assert.Contains("ListTasksAsync", code, StringComparison.Ordinal);
        Assert.Contains("ListEventsAsync", code, StringComparison.Ordinal);
        Assert.Contains("TaskPlanDisplayFormatter.FormatTask", code, StringComparison.Ordinal);
        Assert.Contains("TaskPlanDisplayFormatter.FormatEvent", code, StringComparison.Ordinal);
        Assert.Contains("OpenTaskPlanFolder_Click", code, StringComparison.Ordinal);
        Assert.Contains("selected.Plan.PlanPath", code, StringComparison.Ordinal);
        Assert.Contains("Task plan folder not found", code, StringComparison.Ordinal);
        Assert.Contains("PauseTaskPlan_Click", code, StringComparison.Ordinal);
        Assert.Contains("ResumeTaskPlan_Click", code, StringComparison.Ordinal);
        Assert.Contains("ArchiveTaskPlan_Click", code, StringComparison.Ordinal);
        Assert.Contains("taskPlanService.PausePlanAsync", code, StringComparison.Ordinal);
        Assert.Contains("taskPlanService.ResumePlanAsync", code, StringComparison.Ordinal);
        Assert.Contains("taskPlanService.ArchivePlanAsync", code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Main_window_records_task_plan_dispatch_results_after_hooks()
    {
        var code = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml.cs"));

        Assert.Contains("AgentHookProcessingPipeline", code, StringComparison.Ordinal);
        Assert.Contains("hookProcessingPipeline.ProcessAsync(hookEvent)", code, StringComparison.Ordinal);
        Assert.Contains("new AgentHookEventProcessor", code, StringComparison.Ordinal);
        Assert.Contains("new AgentConversationOrchestrator", code, StringComparison.Ordinal);
        Assert.Contains("taskPlanService", code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Main_window_refreshes_task_plan_list_after_current_workspace_hooks()
    {
        var code = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml.cs"));

        Assert.Contains("await ReloadTaskPlansAsync(hookEvent.Workspace", code, StringComparison.Ordinal);
        Assert.Contains("await ReloadSelectedTaskPlanDetailsAsync(hookEvent.Workspace)", code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Main_window_exposes_conversation_controls()
    {
        var xaml = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml"));

        Assert.Contains("x:Name=\"ConversationTopicTextBox\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"ConversationParticipantsTextBox\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"ConversationListBox\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"ConversationDetailListBox\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"StartManagerConversation_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"StartRoundtableConversation_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"StartPairNegotiationConversation_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"RefreshConversations_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"OpenConversationFolder_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"PauseConversation_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"ResumeConversation_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"StopConversation_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("SelectionChanged=\"ConversationListBox_SelectionChanged\"", xaml, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Main_window_wires_conversation_controls_to_orchestrator()
    {
        var code = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml.cs"));

        Assert.Contains("conversationOrchestrator", code, StringComparison.Ordinal);
        Assert.Contains("StartManagerConversation_Click", code, StringComparison.Ordinal);
        Assert.Contains("StartRoundtableConversation_Click", code, StringComparison.Ordinal);
        Assert.Contains("StartPairNegotiationConversation_Click", code, StringComparison.Ordinal);
        Assert.Contains("StartManagerAsync(new StartAgentManagerConversationRequest", code, StringComparison.Ordinal);
        Assert.Contains("StartRoundtableAsync(new StartRoundtableConversationRequest", code, StringComparison.Ordinal);
        Assert.Contains("StartPairNegotiationAsync(new StartPairNegotiationConversationRequest", code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Main_window_refreshes_conversation_list_after_workspace_start_and_hooks()
    {
        var code = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml.cs"));

        Assert.Contains("ReloadConversationsAsync", code, StringComparison.Ordinal);
        Assert.Contains("await ReloadConversationsAsync(workspace.Path", code, StringComparison.Ordinal);
        Assert.Contains("await ReloadConversationsAsync(workspacePath, conversation.Id)", code, StringComparison.Ordinal);
        Assert.Contains("await ReloadConversationsAsync(hookEvent.Workspace", code, StringComparison.Ordinal);
        Assert.Contains("ReloadSelectedConversationDetailsAsync", code, StringComparison.Ordinal);
        Assert.Contains("OpenConversationFolder_Click", code, StringComparison.Ordinal);
        Assert.Contains("ProcessStartInfo", code, StringComparison.Ordinal);
        Assert.Contains("AgentConversationDisplayFormatter.Format", code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Main_window_wires_conversation_control_buttons_to_service()
    {
        var code = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml.cs"));

        Assert.Contains("AgentConversationControlService", code, StringComparison.Ordinal);
        Assert.Contains("PauseConversation_Click", code, StringComparison.Ordinal);
        Assert.Contains("ResumeConversation_Click", code, StringComparison.Ordinal);
        Assert.Contains("StopConversation_Click", code, StringComparison.Ordinal);
        Assert.Contains("conversationControlService.PauseAsync", code, StringComparison.Ordinal);
        Assert.Contains("conversationControlService.ResumeAsync", code, StringComparison.Ordinal);
        Assert.Contains("conversationControlService.StopAsync", code, StringComparison.Ordinal);
        Assert.Contains("await ReloadConversationsAsync(workspacePath, updated.Id)", code, StringComparison.Ordinal);
        Assert.Contains("await ReloadTimelineAsync(workspacePath)", code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Main_window_records_manual_messages_with_selected_orchestration_context()
    {
        var code = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml.cs"));

        Assert.Contains("var conversationId = await Dispatcher.InvokeAsync(CurrentConversationId)", code, StringComparison.Ordinal);
        Assert.Contains("var planId = await Dispatcher.InvokeAsync(CurrentTaskPlanId)", code, StringComparison.Ordinal);
        Assert.Contains("ManualUserMessageFactory.Create(", code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Main_window_exposes_native_data_folder_diagnostics()
    {
        var xaml = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml"));
        var code = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml.cs"));

        Assert.Contains("Content=\"Open data\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"OpenNativeDataFolder_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("OpenNativeDataFolder_Click", code, StringComparison.Ordinal);
        Assert.Contains("NativeDiagnosticsPaths.ResolveDataDirectory()", code, StringComparison.Ordinal);
        Assert.Contains("Opened native data folder", code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Main_window_exposes_current_workspace_folder_open_action()
    {
        var xaml = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml"));
        var code = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml.cs"));

        Assert.Contains("Content=\"Open\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"OpenWorkspaceFolder_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("OpenWorkspaceFolder_Click", code, StringComparison.Ordinal);
        Assert.Contains("WorkspaceDirectoryValidator.Validate(CurrentWorkspacePath())", code, StringComparison.Ordinal);
        Assert.Contains("Opened workspace folder", code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Main_window_filters_sessions_to_current_workspace_by_default()
    {
        var xaml = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml"));
        var code = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml.cs"));

        Assert.Contains("x:Name=\"CurrentWorkspaceSessionsOnlyCheckBox\"", xaml, StringComparison.Ordinal);
        Assert.Contains("IsChecked=\"True\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Checked=\"CurrentWorkspaceSessionsOnlyCheckBox_Changed\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Unchecked=\"CurrentWorkspaceSessionsOnlyCheckBox_Changed\"", xaml, StringComparison.Ordinal);
        Assert.Contains("ReloadSessionList", code, StringComparison.Ordinal);
        Assert.Contains("SessionListFilter.Filter(", code, StringComparison.Ordinal);
        Assert.Contains("await ReloadTaskPlansAsync(workspace.Path)", code, StringComparison.Ordinal);
        Assert.Contains("ReloadSessionList()", code, StringComparison.Ordinal);
        Assert.Contains("ReloadSessionList(sessionId)", code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Main_window_can_start_all_managed_agents_for_current_workspace()
    {
        var xaml = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml"));
        var code = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml.cs"));

        Assert.Contains("Content=\"Start Agents\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"StartManagedAgents_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("StartManagedAgents_Click", code, StringComparison.Ordinal);
        Assert.Contains("AgentStartupCommandCatalog.BuildManagedAgentStartCommands()", code, StringComparison.Ordinal);
        Assert.Contains("var startedCount = 0", code, StringComparison.Ordinal);
        Assert.Contains("if (await StartAgentAsync(command))", code, StringComparison.Ordinal);
        Assert.Contains("Started managed agents: {startedCount}/{commands.Count}", code, StringComparison.Ordinal);
        Assert.Contains("private async Task<bool> StartAgentAsync", code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Main_window_can_resume_managed_agents_for_current_workspace()
    {
        var xaml = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml"));
        var code = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml.cs"));

        Assert.Contains("Rows=\"5\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Content=\"Resume Agents\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"ResumeManagedAgents_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("ResumeManagedAgents_Click", code, StringComparison.Ordinal);
        Assert.Contains("AgentStartupCommandCatalog.BuildManagedAgentResumeCommands()", code, StringComparison.Ordinal);
        Assert.Contains("StartAgentBatchAsync(commands)", code, StringComparison.Ordinal);
        Assert.Contains("Resumed managed agents: {startedCount}/{commands.Count}", code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Main_window_can_stop_managed_agents_for_current_workspace()
    {
        var xaml = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml"));
        var code = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml.cs"));

        Assert.Contains("Content=\"Stop Agents\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"StopManagedAgents_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("StopManagedAgents_Click", code, StringComparison.Ordinal);
        Assert.Contains("AgentStartupCommandCatalog.IsManagedAgent(session.AgentKind)", code, StringComparison.Ordinal);
        Assert.Contains("IsCurrentWorkspace(session.Workspace.Path)", code, StringComparison.Ordinal);
        Assert.Contains("await inputRouter.TryStopAsync(session.Id)", code, StringComparison.Ordinal);
        Assert.Contains("Stopped managed agents: {stoppedCount}", code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Main_window_can_interrupt_managed_agents_for_current_workspace()
    {
        var xaml = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml"));
        var code = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml.cs"));

        Assert.Contains("Rows=\"5\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Content=\"Interrupt Agents\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Click=\"InterruptManagedAgents_Click\"", xaml, StringComparison.Ordinal);
        Assert.Contains("InterruptManagedAgents_Click", code, StringComparison.Ordinal);
        Assert.Contains("AgentStartupCommandCatalog.IsManagedAgent(session.AgentKind)", code, StringComparison.Ordinal);
        Assert.Contains("IsCurrentWorkspace(session.Workspace.Path)", code, StringComparison.Ordinal);
        Assert.Contains("await inputRouter.TrySendControlDetailedAsync(session.Id, \"\\x03\")", code, StringComparison.Ordinal);
        Assert.Contains("Interrupted managed agents: {interruptedCount}/{targetSessions.Length}", code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Main_window_can_route_input_to_all_managed_agents()
    {
        var xaml = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml"));
        var code = await File.ReadAllTextAsync(FindSourceFile("src", "AgentHub.Native.App", "MainWindow.xaml.cs"));

        Assert.Contains("<ComboBoxItem Content=\"agents\" />", xaml, StringComparison.Ordinal);
        Assert.Contains("AgentProfileTargetResolver.Resolve(targetProfileId)", code, StringComparison.Ordinal);
        Assert.Contains("foreach (var profileId in profileIds)", code, StringComparison.Ordinal);
        Assert.Contains("firstFailedResult?.Status == AgentMessageSendStatus.TerminalNotReady", code, StringComparison.Ordinal);
        Assert.Contains("Sent input to {sentCount}/{profileIds.Count} profile(s)", code, StringComparison.Ordinal);
    }

    private static string FindSourceFile(params string[] relativeParts)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(
                directory.FullName,
                "native",
                "AgentHub.Native",
                Path.Combine(relativeParts));
            if (File.Exists(candidate))
            {
                return candidate;
            }

            directory = directory.Parent;
        }

        throw new FileNotFoundException($"Unable to find source file: {Path.Combine(relativeParts)}");
    }
}
