using System.IO;
using System.Windows;
using System.Windows.Input;
using AgentHub.Native.App.Terminal;
using AgentHub.Native.Core.Hooks;
using AgentHub.Native.Core.Input;
using AgentHub.Native.Core.Processes;
using AgentHub.Native.Core.Profiles;
using EasyWindowsTerminalControl;

namespace AgentHub.Native.App;

public partial class MainWindow : Window
{
    private readonly AgentInputRouter inputRouter = new();
    private readonly Dictionary<string, SessionViewModel> sessions = new(StringComparer.OrdinalIgnoreCase);
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
    }

    private async void MainWindow_Closed(object? sender, EventArgs e)
    {
        if (hookReceiver is not null)
        {
            await hookReceiver.DisposeAsync();
        }
    }

    private void HookReceiver_EventReceived(object? sender, AgentHookEvent hookEvent)
    {
        Dispatcher.Invoke(() =>
        {
            var profile = hookEvent.ProfileId ?? hookEvent.Source ?? "agent";
            HookMessagesListBox.Items.Insert(0, $"{DateTime.Now:HH:mm:ss} {profile}: {hookEvent.Message}");
            StatusTextBlock.Text = $"收到 hook: {profile}";
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
        var workspace = WorkspaceTextBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(workspace))
        {
            StatusTextBlock.Text = "请选择工作目录";
            return;
        }

        if (agentKind != AgentKind.PowerShell)
        {
            StatusTextBlock.Text = "正在安装项目 hook...";
            await ProjectAgentHookInstaller.InstallAsync(
                workspace,
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
                workspace));
        var request = new AgentLaunchRequest(agentKind, ShellKind.PowerShell, workspace, command, args, env);
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
        SessionListBox.Items.Add(session);
        SessionListBox.SelectedItem = session;
        StatusTextBlock.Text = $"已启动 {session.DisplayName}";
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
        if (selectedSessionId is null)
        {
            StatusTextBlock.Text = "没有选中的会话";
            return;
        }

        var text = InjectTextBox.Text;
        if (string.IsNullOrEmpty(text))
        {
            return;
        }

        await inputRouter.SendLineAsync(selectedSessionId, text);
        InjectTextBox.Clear();
        StatusTextBlock.Text = $"已向 {selectedSessionId} 发送输入";
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
        string Workspace,
        EasyTerminalControl Terminal)
    {
        public string DisplayName => $"{AgentKind} / {Workspace}";

        public override string ToString()
        {
            return $"{Id}  {DisplayName}";
        }
    }
}
