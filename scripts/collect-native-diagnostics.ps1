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

function Resolve-DefaultOutputPath {
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    return Join-Path $script:RepoRoot "artifacts/native-diagnostics/$timestamp.md"
}

$script:RepoRoot = Split-Path -Parent $PSScriptRoot
$script:Lines = New-Object System.Collections.Generic.List[string]

if ([string]::IsNullOrWhiteSpace($Output)) {
    $Output = Resolve-DefaultOutputPath
}

$resolvedOutput = [System.IO.Path]::GetFullPath($Output)
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

$generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")

Add-Line "# AgentHub Native Diagnostics"
Add-Line
Add-Line "- Generated at: $generatedAt"
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

Add-Line "## Agent CLIs"
Add-Line
Invoke-DiagnosticCommand "Codex CLI" "where.exe codex; codex --version"
Invoke-DiagnosticCommand "Claude CLI" "where.exe claude; claude --version"
Invoke-DiagnosticCommand "Gemini CLI" "where.exe gemini; gemini --version"

Add-Line "## Python"
Add-Line
Invoke-DiagnosticCommand "Python Launchers" "py -0p; where.exe python; python --version"
if (-not [string]::IsNullOrWhiteSpace($Python)) {
    Invoke-DiagnosticCommand "Hook Python Probe" "& $startNativeCommand -Check -Agent codex$pythonArgument"
}

Add-Line "## Native Launch Checks"
Add-Line
Invoke-DiagnosticCommand "PowerShell Host Codex Check" "& $startNativeCommand -Check$workspaceArgument -Shell powershell -Agent codex$pythonArgument"
Invoke-DiagnosticCommand "cmd Host Codex Check" "& $startNativeCommand -Check$workspaceArgument -Shell cmd -Agent codex$pythonArgument"
Invoke-DiagnosticCommand "Plain PowerShell Host Check" "& $startNativeCommand -Check$workspaceArgument -Agent powershell"
Invoke-DiagnosticCommand "Plain cmd Host Check" "& $startNativeCommand -Check$workspaceArgument -Agent cmd"
Invoke-DiagnosticCommand "Publish Check" "& $publishNativeCommand -Check"

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
