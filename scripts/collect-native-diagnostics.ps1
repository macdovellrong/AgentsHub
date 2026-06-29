param(
    [string]$Workspace,
    [string]$Python = "py -3.11",
    [string]$Output
)

$ErrorActionPreference = "Stop"

function Quote-PS {
    param([string]$Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

function Add-Line {
    param([string]$Text = "")
    $script:Lines.Add($Text) | Out-Null
}

function Invoke-DiagnosticCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [string]$WorkingDirectory = $script:RepoRoot
    )

    Add-Line "### $Title"
    Add-Line
    Add-Line '```powershell'
    Add-Line $Command
    Add-Line '```'
    Add-Line
    Add-Line '```text'

    Push-Location -LiteralPath $WorkingDirectory
    try {
        $output = & powershell -NoProfile -ExecutionPolicy Bypass -Command $Command 2>&1
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) {
            $exitCode = 0
        }
    }
    catch {
        $output = @($_.Exception.Message)
        $exitCode = 1
    }
    finally {
        Pop-Location
    }

    Add-Line "Exit code: $exitCode"
    foreach ($line in @($output)) {
        Add-Line ([string]$line)
    }
    Add-Line '```'
    Add-Line
}

function Get-NativeAgentCommandCandidates {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandName
    )

    $extension = [System.IO.Path]::GetExtension($CommandName)
    if (-not [string]::IsNullOrWhiteSpace($extension)) {
        return @($CommandName)
    }

    $nativeExtensions = @(".COM", ".EXE", ".BAT", ".CMD")
    $pathExtensions = @()
    if (-not [string]::IsNullOrWhiteSpace($env:PATHEXT)) {
        foreach ($pathExtension in ($env:PATHEXT -split ";")) {
            $trimmed = $pathExtension.Trim()
            if ($nativeExtensions -contains $trimmed.ToUpperInvariant()) {
                $pathExtensions += $trimmed
            }
        }
    }

    if ($pathExtensions.Count -eq 0) {
        $pathExtensions = $nativeExtensions
    }

    $candidates = @()
    foreach ($pathExtension in $pathExtensions) {
        $candidates += "$CommandName$pathExtension"
    }

    return $candidates | Select-Object -Unique
}

function Resolve-NativeAgentCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandName
    )

    if ([string]::IsNullOrWhiteSpace($env:PATH)) {
        return $null
    }

    foreach ($directory in ($env:PATH -split [System.IO.Path]::PathSeparator)) {
        if ([string]::IsNullOrWhiteSpace($directory)) {
            continue
        }

        foreach ($candidate in (Get-NativeAgentCommandCandidates -CommandName $CommandName)) {
            $candidatePath = Join-Path $directory.Trim() $candidate
            if (Test-Path -LiteralPath $candidatePath -PathType Leaf) {
                return $candidatePath
            }
        }
    }

    return $null
}

function Add-NativeLauncherDiagnostics {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AgentName,
        [Parameter(Mandatory = $true)]
        [string]$CommandName
    )

    Add-Line "### $AgentName Native Launcher"
    Add-Line
    Add-Line '```powershell'
    Add-Line "Resolve native Windows launcher for $CommandName (.com/.exe/.bat/.cmd)"
    Add-Line '```'
    Add-Line
    Add-Line '```text'
    $launcher = Resolve-NativeAgentCommand -CommandName $CommandName
    if ([string]::IsNullOrWhiteSpace($launcher)) {
        Add-Line "Exit code: 1"
        Add-Line "Native Windows launcher was not found for '$CommandName'."
        Add-Line '```'
        Add-Line
        return $null
    }

    Add-Line "Exit code: 0"
    Add-Line $launcher
    Add-Line '```'
    Add-Line
    return $launcher
}

function Invoke-NativeLauncherHelp {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Launcher
    )

    $extension = [System.IO.Path]::GetExtension($Launcher)
    if ($extension -in @(".cmd", ".bat")) {
        $cmd = Join-Path ([Environment]::SystemDirectory) "cmd.exe"
        $commandLine = "`"$Launcher`" --help"
        $previousLocation = Get-Location
        try {
            Set-Location -LiteralPath ([Environment]::SystemDirectory)
            $output = & $cmd /d /s /c $commandLine 2>&1
            $exitCode = $LASTEXITCODE
        }
        finally {
            Set-Location -LiteralPath $previousLocation
        }
    }
    else {
        $output = & $Launcher --help 2>&1
        $exitCode = $LASTEXITCODE
    }

    if ($null -eq $exitCode) {
        $exitCode = 0
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = @($output)
    }
}

function Add-CodexNoAltScreenProbe {
    param(
        [string]$Launcher
    )

    Add-Line "### Codex No Alt Screen Probe"
    Add-Line
    Add-Line '```powershell'
    if ([string]::IsNullOrWhiteSpace($Launcher)) {
        Add-Line "Codex native launcher was not found; --no-alt-screen probe skipped."
    }
    else {
        Add-Line "$(Quote-PS $Launcher) --help"
    }
    Add-Line '```'
    Add-Line
    Add-Line '```text'

    if ([string]::IsNullOrWhiteSpace($Launcher)) {
        Add-Line "Exit code: 1"
        Add-Line "Codex native launcher was not found."
        Add-Line '```'
        Add-Line
        return
    }

    try {
        $probe = Invoke-NativeLauncherHelp -Launcher $Launcher
        Add-Line "Exit code: $($probe.ExitCode)"
        $helpText = @($probe.Output) -join "`n"
        if ($helpText -like "*--no-alt-screen*") {
            Add-Line "Codex --no-alt-screen support: yes"
        }
        else {
            Add-Line "Codex --no-alt-screen support: no"
        }

        foreach ($line in @($probe.Output)) {
            Add-Line ([string]$line)
        }
    }
    catch {
        Add-Line "Exit code: 1"
        Add-Line $_.Exception.Message
    }

    Add-Line '```'
    Add-Line
}

function Add-NativeTerminalBackendDiagnostics {
    $nativeAppProject = Join-Path $script:RepoRoot "native/AgentHub.Native/src/AgentHub.Native.App/AgentHub.Native.App.csproj"
    $nativeAppProjectCommand = @"
`$projectPath = $(Quote-PS $nativeAppProject)
if (Test-Path -LiteralPath `$projectPath -PathType Leaf) {
    [xml]`$project = Get-Content -LiteralPath `$projectPath
    [pscustomobject]@{
        Project = `$projectPath
        TargetFramework = (`$project.Project.PropertyGroup | ForEach-Object { `$_.TargetFramework } | Where-Object { `$_ } | Select-Object -First 1)
        RuntimeIdentifier = (`$project.Project.PropertyGroup | ForEach-Object { `$_.RuntimeIdentifier } | Where-Object { `$_ } | Select-Object -First 1)
        UseWPF = (`$project.Project.PropertyGroup | ForEach-Object { `$_.UseWPF } | Where-Object { `$_ } | Select-Object -First 1)
    } | Format-List
    `$project.Project.ItemGroup.PackageReference |
        ForEach-Object {
            [pscustomobject]@{
                Include = `$_.Include
                Version = `$_.Version
            }
        } |
        Format-Table -AutoSize
}
else {
    "AgentHub.Native.App.csproj not found: `$projectPath"
}
"@

    $publishedDeps = Join-Path $script:RepoRoot "AgentHub.Native.App.deps.json"
    $publishedDepsCommand = @"
`$depsPath = $(Quote-PS $publishedDeps)
if (Test-Path -LiteralPath `$depsPath -PathType Leaf) {
    "AgentHub.Native.App.deps.json: `$depsPath"
    `$patterns = @(
        'EasyWindowsTerminalControl',
        'Microsoft.Terminal',
        'Microsoft.WindowsAppSDK',
        'Microsoft.Windows.CsWinRT'
    )
    foreach (`$pattern in `$patterns) {
        "Pattern: `$pattern"
        Select-String -LiteralPath `$depsPath -Pattern `$pattern -SimpleMatch |
            Select-Object LineNumber,Line |
            Format-Table -AutoSize -Wrap
    }
}
else {
    "AgentHub.Native.App.deps.json not found: `$depsPath"
}
"@

    Add-Line "## Native Terminal Backend"
    Add-Line
    Invoke-DiagnosticCommand "Native App Project" $nativeAppProjectCommand
    Invoke-DiagnosticCommand "Published Dependency Manifest" $publishedDepsCommand
}

function Resolve-DefaultOutputPath {
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    return Join-Path $script:RepoRoot "artifacts/native-diagnostics/$timestamp.md"
}

$script:RepoRoot = Split-Path -Parent $PSScriptRoot
$script:Lines = New-Object System.Collections.Generic.List[string]

if ([string]::IsNullOrWhiteSpace($Output)) {
    $Output = Resolve-DefaultOutputPath
}

$resolvedOutput = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)
$outputDirectory = Split-Path -Parent $resolvedOutput
if (-not [string]::IsNullOrWhiteSpace($outputDirectory)) {
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}

$workspaceArgument = if ([string]::IsNullOrWhiteSpace($Workspace)) { "" } else { " -Workspace $(Quote-PS $Workspace)" }
$pythonArgument = if ([string]::IsNullOrWhiteSpace($Python)) { "" } else { " -Python $(Quote-PS $Python)" }
$localAppData = $env:LOCALAPPDATA
if ([string]::IsNullOrWhiteSpace($localAppData)) {
    $localAppData = [Environment]::GetFolderPath("LocalApplicationData")
}
$nativeDataDirectory = Join-Path $localAppData "AgentHub/Native"
$hookLogPath = Join-Path $nativeDataDirectory "hooks.jsonl"
$startNativeCommand = ".\scripts\start-native.ps1"
$publishNativeCommand = ".\scripts\publish-native.ps1"
$repoStartNativeScript = Join-Path $script:RepoRoot "scripts/start-native.ps1"
$publishedApp = Join-Path $script:RepoRoot "AgentHub.Native.App.exe"
$publishedStarter = Join-Path $script:RepoRoot "start-agenthub-native.bat"
$executionMode = if (Test-Path -LiteralPath $repoStartNativeScript -PathType Leaf) {
    "repository"
}
elseif ((Test-Path -LiteralPath $publishedApp -PathType Leaf) -or
    (Test-Path -LiteralPath $publishedStarter -PathType Leaf)) {
    "published package"
}
else {
    "standalone diagnostics"
}

$generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")

Add-Line "# AgentHub Native Diagnostics"
Add-Line
Add-Line "- Generated at: $generatedAt"
Add-Line "- Execution mode: $executionMode"
Add-Line "- Repository: $script:RepoRoot"
Add-Line "- Workspace: $Workspace"
Add-Line "- Python command: $Python"
Add-Line "- Native data directory: $nativeDataDirectory"
Add-Line

Add-Line "## Repository"
Add-Line
Invoke-DiagnosticCommand "Git Status" "git status --short --branch"
Invoke-DiagnosticCommand "Git Head" "git rev-parse HEAD"
Invoke-DiagnosticCommand "Git Remote" "git remote -v"

Add-Line "## Runtime"
Add-Line
Invoke-DiagnosticCommand "PowerShell" "`$PSVersionTable.PSVersion.ToString(); where.exe powershell; where.exe cmd"
Invoke-DiagnosticCommand ".NET" "where.exe dotnet; dotnet --info"

Add-Line "## Windows"
Add-Line
Invoke-DiagnosticCommand "OS Version" "[Environment]::OSVersion.VersionString; Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture | Format-List"
Invoke-DiagnosticCommand "Display Scaling" "Get-CimInstance Win32_DesktopMonitor | Select-Object Name,ScreenWidth,ScreenHeight | Format-Table -AutoSize; Get-ItemProperty 'HKCU:\Control Panel\Desktop' | Select-Object LogPixels,Win8DpiScaling | Format-List"

Add-Line "## Terminal Environment"
Add-Line
Invoke-DiagnosticCommand "Windows Terminal Package" "Get-AppxPackage -Name Microsoft.WindowsTerminal -ErrorAction SilentlyContinue | Select-Object Name,PackageFullName,Version,InstallLocation | Format-List; Get-AppxPackage -Name Microsoft.WindowsTerminalPreview -ErrorAction SilentlyContinue | Select-Object Name,PackageFullName,Version,InstallLocation | Format-List"
Invoke-DiagnosticCommand "Windows Terminal Settings" "`$settingsPaths = @((Join-Path `$env:LOCALAPPDATA 'Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json'), (Join-Path `$env:LOCALAPPDATA 'Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/settings.json')); foreach (`$settingsPath in `$settingsPaths) { [pscustomobject]@{ Path = `$settingsPath; Exists = Test-Path -LiteralPath `$settingsPath -PathType Leaf } } | Format-Table -AutoSize"
Invoke-DiagnosticCommand "Console Host Registry" "Get-ItemProperty 'HKCU:\Console' -ErrorAction SilentlyContinue | Select-Object ForceV2,LineWrap,QuickEdit,InsertMode,ScreenBufferSize,WindowSize,VirtualTerminalLevel,DelegationConsole,DelegationTerminal | Format-List; Get-ItemProperty 'HKCU:\Console\%%Startup' -ErrorAction SilentlyContinue | Select-Object DelegationConsole,DelegationTerminal | Format-List"

Add-NativeTerminalBackendDiagnostics

Add-Line "## Input Devices"
Add-Line
Invoke-DiagnosticCommand "Pointer and HID Devices" "Get-PnpDevice -Class Mouse,Keyboard,HIDClass | Select-Object Status,Class,FriendlyName,InstanceId | Format-Table -AutoSize"
Invoke-DiagnosticCommand "Pointing Device Details" "Get-CimInstance Win32_PointingDevice | Select-Object Name,Manufacturer,DeviceID,PointingType,NumberOfButtons,HardwareType,Status | Format-List"
Invoke-DiagnosticCommand "Precision Touchpad Settings" "Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad' -ErrorAction SilentlyContinue | Format-List; Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad' -ErrorAction SilentlyContinue | Select-Object PSChildName | Format-Table -AutoSize"

if ((Test-Path -LiteralPath $publishedApp -PathType Leaf) -or
    (Test-Path -LiteralPath $publishedStarter -PathType Leaf)) {
    Add-Line "## Published Package"
    Add-Line
    Invoke-DiagnosticCommand "Published Files" "Test-Path -LiteralPath '.\AgentHub.Native.App.exe'; Test-Path -LiteralPath '.\start-agenthub-native.bat'; Test-Path -LiteralPath '.\start-agenthub-native.ps1'; Test-Path -LiteralPath '.\collect-native-diagnostics.bat'; Test-Path -LiteralPath '.\collect-native-diagnostics.ps1'; Test-Path -LiteralPath '.\validate-native-laptop.bat'; Test-Path -LiteralPath '.\validate-native-laptop.ps1'; Test-Path -LiteralPath '.\scripts\collect-native-diagnostics.ps1'; Test-Path -LiteralPath '.\scripts\hooks\agenthub_hook_common.py'; Test-Path -LiteralPath '.\scripts\hooks\agenthub_codex_stop.py'; Test-Path -LiteralPath '.\scripts\hooks\agenthub_claude_stop.py'; Test-Path -LiteralPath '.\scripts\hooks\agenthub_gemini_after_agent.py'"
}

Add-Line "## Agent CLIs"
Add-Line
Invoke-DiagnosticCommand "Codex CLI" "where.exe codex; codex --version"
$codexNativeLauncher = Add-NativeLauncherDiagnostics -AgentName "Codex" -CommandName "codex"
Add-CodexNoAltScreenProbe -Launcher $codexNativeLauncher
Invoke-DiagnosticCommand "Claude CLI" "where.exe claude; claude --version"
Invoke-DiagnosticCommand "Gemini CLI" "where.exe gemini; gemini --version"

Add-Line "## Python"
Add-Line
Invoke-DiagnosticCommand "Python Launchers" "py -0p; where.exe python; python --version"
if (-not [string]::IsNullOrWhiteSpace($Python) -and
    (Test-Path -LiteralPath $repoStartNativeScript -PathType Leaf)) {
    Invoke-DiagnosticCommand "Hook Python Probe" "& $startNativeCommand -Check -Agent codex$pythonArgument"
}

Add-Line "## Native Launch Checks"
Add-Line
if (Test-Path -LiteralPath $repoStartNativeScript -PathType Leaf) {
    Invoke-DiagnosticCommand "PowerShell Host Codex Check" "& $startNativeCommand -Check$workspaceArgument -Shell powershell -Agent codex$pythonArgument"
    Invoke-DiagnosticCommand "cmd Host Codex Check" "& $startNativeCommand -Check$workspaceArgument -Shell cmd -Agent codex$pythonArgument"
    Invoke-DiagnosticCommand "Plain PowerShell Host Check" "& $startNativeCommand -Check$workspaceArgument -Agent powershell"
    Invoke-DiagnosticCommand "Plain cmd Host Check" "& $startNativeCommand -Check$workspaceArgument -Agent cmd"
    Invoke-DiagnosticCommand "Publish Check" "& $publishNativeCommand -Check"
}
else {
    Add-Line '```text'
    Add-Line "Repository launch checks skipped because scripts/start-native.ps1 was not found. This is expected in a published package."
    Add-Line '```'
    Add-Line
}

Add-Line "## Hook Diagnostics"
Add-Line
Add-Line "- Hook log path: $hookLogPath"
Add-Line
if (Test-Path -LiteralPath $hookLogPath -PathType Leaf) {
    Invoke-DiagnosticCommand "Last Hook Log Lines" "Get-Content -LiteralPath $(Quote-PS $hookLogPath) -Tail 80"
}
else {
    Add-Line '```text'
    Add-Line "Hook log does not exist yet: $hookLogPath"
    Add-Line '```'
    Add-Line
}

Set-Content -LiteralPath $resolvedOutput -Value ($script:Lines -join [Environment]::NewLine) -Encoding UTF8
Write-Host "AgentHub Native diagnostics written to: $resolvedOutput"
exit 0
