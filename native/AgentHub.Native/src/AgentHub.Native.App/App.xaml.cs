using System.Windows;
using AgentHub.Native.Core.Settings;

namespace AgentHub.Native.App;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var window = new MainWindow(NativeAppStartupOptions.Parse(e.Args));
        MainWindow = window;
        window.Show();
    }
}
