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
