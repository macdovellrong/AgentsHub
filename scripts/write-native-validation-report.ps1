param(
    [string]$Workspace,
    [string]$LatestDiagnostics,
    [string]$LatestLaptopValidation,
    [string]$HookLog,
    [string[]]$Session = @(),
    [string]$Output
)

$ErrorActionPreference = "Stop"

function Resolve-DefaultDataDirectory {
    $localAppData = $env:LOCALAPPDATA
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        $localAppData = [Environment]::GetFolderPath("LocalApplicationData")
    }

    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        return Join-Path $PSScriptRoot ".agenthub-native"
    }

    return Join-Path $localAppData "AgentHub/Native"
}

function Resolve-ReportOutputPath {
    param([string]$OutputPath)

    if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
        return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
    }

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    return Join-Path (Resolve-DefaultDataDirectory) "diagnostics/native-manual-validation-$timestamp.md"
}

function Format-Optional {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return "unavailable"
    }

    return $Value
}

$dataDirectory = Resolve-DefaultDataDirectory
if ([string]::IsNullOrWhiteSpace($LatestDiagnostics)) {
    $LatestDiagnostics = Join-Path $dataDirectory "diagnostics/latest-diagnostics.txt"
}
if ([string]::IsNullOrWhiteSpace($LatestLaptopValidation)) {
    $LatestLaptopValidation = Join-Path $dataDirectory "diagnostics/latest-laptop-validation.txt"
}
if ([string]::IsNullOrWhiteSpace($HookLog)) {
    $HookLog = Join-Path $dataDirectory "hooks.jsonl"
}

$resolvedOutput = Resolve-ReportOutputPath -OutputPath $Output
$outputDirectory = Split-Path -Parent $resolvedOutput
if (-not [string]::IsNullOrWhiteSpace($outputDirectory)) {
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("# AgentHub Native Manual Validation") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("- Generated at: $((Get-Date).ToString('O'))") | Out-Null
$lines.Add("- Workspace: $(Format-Optional $Workspace)") | Out-Null
$lines.Add("- Latest diagnostics pointer: $(Format-Optional $LatestDiagnostics)") | Out-Null
$lines.Add("- Latest laptop validation pointer: $(Format-Optional $LatestLaptopValidation)") | Out-Null
$lines.Add("- Hook log: $(Format-Optional $HookLog)") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("## Sessions At Capture") | Out-Null
$lines.Add("") | Out-Null

if ($null -eq $Session -or $Session.Count -eq 0) {
    $lines.Add("- none") | Out-Null
}
else {
    foreach ($item in $Session) {
        if (-not [string]::IsNullOrWhiteSpace($item)) {
            $lines.Add("- $item") | Out-Null
        }
    }
}

$lines.Add("") | Out-Null
$lines.Add("## Checklist") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("- [ ] validate-native-laptop.ps1 completed and latest-laptop-validation.txt points to a report.") | Out-Null
$lines.Add("- [ ] Run diagnostics completed and latest-diagnostics.txt points to a report.") | Out-Null
$lines.Add("- [ ] Scroll Test shows a scrollbar.") | Out-Null
$lines.Add("- [ ] Mouse wheel scrolls upward in Scroll Test.") | Out-Null
$lines.Add("- [ ] Touchpad scrolls upward in Scroll Test.") | Out-Null
$lines.Add("- [ ] Codex resume starts as codex --no-alt-screen resume.") | Out-Null
$lines.Add("- [ ] Codex resume shows scrollback and can scroll upward.") | Out-Null
$lines.Add("- [ ] AgentHub input sends text to Codex.") | Out-Null
$lines.Add("- [ ] Shift+Enter inserts a newline in AgentHub input.") | Out-Null
$lines.Add("- [ ] Codex hook output appears in Collaboration timeline.") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("## Notes") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("- Scroll Test result:") | Out-Null
$lines.Add("- Codex resume result:") | Out-Null
$lines.Add("- Input result:") | Out-Null
$lines.Add("- Hook result:") | Out-Null
$lines.Add("- Remaining issue:") | Out-Null

Set-Content -LiteralPath $resolvedOutput -Value ($lines -join [Environment]::NewLine) -Encoding UTF8
Write-Host "Manual validation report: $resolvedOutput"
exit 0
