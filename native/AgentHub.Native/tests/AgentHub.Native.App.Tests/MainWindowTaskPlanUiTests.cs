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
