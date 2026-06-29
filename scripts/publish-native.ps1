param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",
    [string]$Runtime = "win-x64",
    [string]$Output = "artifacts/native/win-x64",
    [switch]$FrameworkDependent,
    [switch]$Check
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$nativeProject = Join-Path $repoRoot "native/AgentHub.Native/src/AgentHub.Native.App/AgentHub.Native.App.csproj"
$hookSource = Join-Path $repoRoot "scripts/hooks"
$diagnosticsScript = Join-Path $repoRoot "scripts/collect-native-diagnostics.ps1"

if (-not (Test-Path -LiteralPath $nativeProject)) {
    throw "AgentHub Native project not found: $nativeProject"
}

if (-not (Test-Path -LiteralPath (Join-Path $hookSource "agenthub_hook_common.py"))) {
    throw "AgentHub hook scripts not found: $hookSource"
}

if (-not (Test-Path -LiteralPath $diagnosticsScript)) {
    throw "AgentHub native diagnostics script not found: $diagnosticsScript"
}

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if ($null -eq $dotnet) {
    throw "dotnet was not found in PATH. Install the .NET 10 SDK, then run this script again."
}

$sdks = & dotnet --list-sdks
if (-not ($sdks | Where-Object { $_ -match "^(1[0-9]|[2-9][0-9])\." })) {
    throw ".NET 10 SDK or newer was not found. Install the .NET 10 SDK, then run this script again."
}

Set-Location -LiteralPath $repoRoot
$outputPath = [System.IO.Path]::GetFullPath($Output)
$selfContained = -not $FrameworkDependent.IsPresent

if ($Check) {
    Write-Host "AgentHub Native publish check passed."
    Write-Host "Project: $nativeProject"
    Write-Host "Hooks: $hookSource"
    Write-Host "Diagnostics: $diagnosticsScript"
    Write-Host "Output: $outputPath"
    Write-Host "Self-contained: $selfContained"
    exit 0
}

$publishArgs = @(
    "publish",
    $nativeProject,
    "-c",
    $Configuration,
    "-r",
    $Runtime,
    "--self-contained",
    $selfContained.ToString().ToLowerInvariant(),
    "-o",
    $outputPath
)

& dotnet @publishArgs

$publishedHooks = Join-Path $outputPath "scripts/hooks"
New-Item -ItemType Directory -Force -Path $publishedHooks | Out-Null
Get-ChildItem -LiteralPath $hookSource -Force |
    Where-Object { $_.Name -ne "__pycache__" } |
    Copy-Item -Destination $publishedHooks -Recurse -Force
Get-ChildItem -LiteralPath $publishedHooks -Recurse -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $publishedHooks -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -eq ".pyc" } |
    Remove-Item -Force

$publishedScripts = Join-Path $outputPath "scripts"
New-Item -ItemType Directory -Force -Path $publishedScripts | Out-Null
Copy-Item -LiteralPath $diagnosticsScript -Destination (Join-Path $publishedScripts "collect-native-diagnostics.ps1") -Force

$starterPath = Join-Path $outputPath "start-agenthub-native.bat"
$starter = @"
@echo off
setlocal
pushd "%~dp0" || exit /b 1
set "AGENTHUB_HOOKS_SOURCE_DIR=%CD%\scripts\hooks"
AgentHub.Native.App.exe %*
set "AGENTHUB_NATIVE_EXIT_CODE=%ERRORLEVEL%"
popd
if not "%AGENTHUB_NATIVE_EXIT_CODE%"=="0" (
  echo AgentHub Native exited with code %AGENTHUB_NATIVE_EXIT_CODE%.
  pause
)
exit /b %AGENTHUB_NATIVE_EXIT_CODE%
"@
Set-Content -LiteralPath $starterPath -Value $starter -Encoding ASCII

$powershellStarterPath = Join-Path $outputPath "start-agenthub-native.ps1"
$powershellStarter = @'
$ErrorActionPreference = "Stop"
$packageRoot = $PSScriptRoot
$env:AGENTHUB_HOOKS_SOURCE_DIR = Join-Path $packageRoot "scripts/hooks"
Push-Location -LiteralPath $packageRoot
try {
    & (Join-Path $packageRoot "AgentHub.Native.App.exe") @args
    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode) {
        $exitCode = 0
    }
}
finally {
    Pop-Location
}

if ($exitCode -ne 0) {
    Write-Host "AgentHub Native exited with code $exitCode."
}
exit $exitCode
'@
Set-Content -LiteralPath $powershellStarterPath -Value $powershellStarter -Encoding UTF8

$diagnosticsStarterPath = Join-Path $outputPath "collect-native-diagnostics.bat"
$diagnosticsStarter = @"
@echo off
setlocal
pushd "%~dp0" || exit /b 1
set "AGENTHUB_HOOKS_SOURCE_DIR=%CD%\scripts\hooks"
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\collect-native-diagnostics.ps1" %*
set "AGENTHUB_NATIVE_DIAGNOSTICS_EXIT_CODE=%ERRORLEVEL%"
popd
if not "%AGENTHUB_NATIVE_DIAGNOSTICS_EXIT_CODE%"=="0" (
  echo AgentHub Native diagnostics exited with code %AGENTHUB_NATIVE_DIAGNOSTICS_EXIT_CODE%.
  pause
)
exit /b %AGENTHUB_NATIVE_DIAGNOSTICS_EXIT_CODE%
"@
Set-Content -LiteralPath $diagnosticsStarterPath -Value $diagnosticsStarter -Encoding ASCII

$powershellDiagnosticsStarterPath = Join-Path $outputPath "collect-native-diagnostics.ps1"
$powershellDiagnosticsStarter = @'
$ErrorActionPreference = "Stop"
$packageRoot = $PSScriptRoot
$env:AGENTHUB_HOOKS_SOURCE_DIR = Join-Path $packageRoot "scripts/hooks"
Push-Location -LiteralPath $packageRoot
try {
    & (Join-Path $packageRoot "scripts/collect-native-diagnostics.ps1") @args
    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode) {
        $exitCode = 0
    }
}
finally {
    Pop-Location
}

if ($exitCode -ne 0) {
    Write-Host "AgentHub Native diagnostics exited with code $exitCode."
}
exit $exitCode
'@
Set-Content -LiteralPath $powershellDiagnosticsStarterPath -Value $powershellDiagnosticsStarter -Encoding UTF8

$powershellValidationPath = Join-Path $outputPath "validate-native-laptop.ps1"
$powershellValidation = @'
param(
    [string]$Workspace,
    [string]$Python = "py -3.11",
    [string]$Output
)

$ErrorActionPreference = "Stop"

function Resolve-ValidationOutputPath {
    param(
        [string]$OutputPath,
        [string]$PackageRoot
    )

    if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
        return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
    }

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $defaultOutputPath = Join-Path $PackageRoot "artifacts/native-diagnostics/laptop-validation-$timestamp.md"
    return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($defaultOutputPath)
}

function Write-LatestValidationPointer {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ReportPath,
        [Parameter(Mandatory = $true)]
        [string]$Status,
        [Parameter(Mandatory = $true)]
        [object[]]$Steps
    )

    $directory = Split-Path -Parent $ReportPath
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }

    $pointerPath = Join-Path $directory "latest-laptop-validation.txt"
    $lines = @(
        "timestamp: $((Get-Date).ToString('O'))",
        "status: $Status",
        "report: $ReportPath"
    )
    foreach ($step in $Steps) {
        $lines += "step: $($step.Name) = $($step.Status)"
    }

    Set-Content -LiteralPath $pointerPath -Value $lines -Encoding UTF8
    return $pointerPath
}

function Invoke-ValidationStep {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    Write-Host "== $Name =="
    try {
        & $Action
        $script:ValidationSteps += [pscustomobject]@{
            Name = $Name
            Status = "passed"
        }
        Write-Host "PASS: $Name"
    }
    catch {
        $script:ValidationHadFailure = $true
        $script:ValidationSteps += [pscustomobject]@{
            Name = $Name
            Status = "failed"
            Error = $_.Exception.Message
        }
        Write-Host "FAIL: $Name"
        Write-Host $_.Exception.Message
    }
}

function Split-HookPythonCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command
    )

    $trimmed = $Command.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        return $null
    }

    if ($trimmed.StartsWith('"')) {
        $endQuote = $trimmed.IndexOf('"', 1)
        if ($endQuote -lt 0) {
            throw "Invalid Python command, missing closing quote: $Command"
        }

        $executable = $trimmed.Substring(1, $endQuote - 1)
        $remainder = $trimmed.Substring($endQuote + 1).Trim()
    }
    else {
        $exeIndex = $trimmed.IndexOf(".exe", [StringComparison]::OrdinalIgnoreCase)
        if ($exeIndex -ge 0) {
            $executableEnd = $exeIndex + 4
            $executable = $trimmed.Substring(0, $executableEnd)
            $remainder = $trimmed.Substring($executableEnd).Trim()
        }
        else {
            $firstSpace = $trimmed.IndexOf(' ')
            if ($firstSpace -lt 0) {
                $executable = $trimmed
                $remainder = ""
            }
            else {
                $executable = $trimmed.Substring(0, $firstSpace)
                $remainder = $trimmed.Substring($firstSpace + 1).Trim()
            }
        }
    }

    $arguments = @()
    if (-not [string]::IsNullOrWhiteSpace($remainder)) {
        $arguments = $remainder -split '\s+'
    }

    return [pscustomobject]@{
        Executable = $executable
        Arguments = $arguments
    }
}

function Test-HookPythonCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command
    )

    $parsed = Split-HookPythonCommand -Command $Command
    if ($null -eq $parsed) {
        return
    }

    $probe = "import json, pathlib, sys, urllib.request; print(sys.executable)"
    $probeArguments = @()
    foreach ($argument in $parsed.Arguments) {
        $probeArguments += [string]$argument
    }
    $probeArguments += @("-c", $probe)
    try {
        $output = & $parsed.Executable @probeArguments 2>&1
    }
    catch {
        throw "Hook Python command could not be started: $Command`n$($_.Exception.Message)"
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Hook Python command failed: $Command`n$output"
    }

    Write-Host "Hook Python check passed: $Command"
    foreach ($line in $output) {
        Write-Host "  $line"
    }
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

$packageRoot = $PSScriptRoot
$env:AGENTHUB_HOOKS_SOURCE_DIR = Join-Path $packageRoot "scripts/hooks"
$diagnosticsScript = Join-Path $packageRoot "scripts/collect-native-diagnostics.ps1"
$resolvedOutput = Resolve-ValidationOutputPath -OutputPath $Output -PackageRoot $packageRoot

$script:ValidationSteps = @()
$script:ValidationHadFailure = $false

Invoke-ValidationStep "published package files" {
    $requiredFiles = @(
        "AgentHub.Native.App.exe",
        "start-agenthub-native.ps1",
        "collect-native-diagnostics.ps1",
        "validate-native-laptop.bat",
        "validate-native-laptop.ps1",
        "scripts/collect-native-diagnostics.ps1",
        "scripts/hooks/agenthub_hook_common.py",
        "scripts/hooks/agenthub_codex_stop.py",
        "scripts/hooks/agenthub_claude_stop.py",
        "scripts/hooks/agenthub_gemini_after_agent.py"
    )

    foreach ($relativePath in $requiredFiles) {
        $path = Join-Path $packageRoot $relativePath
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Published package file was not found: $relativePath"
        }
    }
}

Invoke-ValidationStep "powershell host" {
    $path = Join-Path ([Environment]::SystemDirectory) "WindowsPowerShell/v1.0/powershell.exe"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "PowerShell host was not found: $path"
    }
}

Invoke-ValidationStep "cmd host" {
    $path = Join-Path ([Environment]::SystemDirectory) "cmd.exe"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "cmd host was not found: $path"
    }
}

Invoke-ValidationStep "codex native launcher" {
    $launcher = Resolve-NativeAgentCommand -CommandName "codex"
    if ([string]::IsNullOrWhiteSpace($launcher)) {
        throw "Codex native Windows launcher was not found in PATH."
    }

    Write-Host $launcher
    $probe = Invoke-NativeLauncherHelp -Launcher $launcher
    $helpText = @($probe.Output) -join "`n"
    if ($helpText -notlike "*--no-alt-screen*") {
        throw "Codex CLI does not support --no-alt-screen. Update Codex CLI before launching AgentHub Native Codex sessions."
    }
}

Invoke-ValidationStep "hook python" {
    Test-HookPythonCommand -Command $Python
}

Invoke-ValidationStep "native diagnostics report" {
    & $diagnosticsScript -Workspace $Workspace -Python $Python -Output $resolvedOutput
}

$status = if ($script:ValidationHadFailure) { "failed" } else { "passed" }
$pointerPath = Write-LatestValidationPointer -ReportPath $resolvedOutput -Status $status -Steps $script:ValidationSteps

Write-Host "Native laptop validation completed."
Write-Host "Status: $status"
Write-Host "Diagnostics report: $resolvedOutput"
Write-Host "Latest pointer: $pointerPath"

if ($script:ValidationHadFailure) {
    exit 1
}

exit 0
'@
Set-Content -LiteralPath $powershellValidationPath -Value $powershellValidation -Encoding UTF8

$validationStarterPath = Join-Path $outputPath "validate-native-laptop.bat"
$validationStarter = @"
@echo off
setlocal
pushd "%~dp0" || exit /b 1
set "AGENTHUB_HOOKS_SOURCE_DIR=%CD%\scripts\hooks"
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\validate-native-laptop.ps1" %*
set "AGENTHUB_NATIVE_VALIDATION_EXIT_CODE=%ERRORLEVEL%"
popd
if not "%AGENTHUB_NATIVE_VALIDATION_EXIT_CODE%"=="0" (
  echo AgentHub Native laptop validation exited with code %AGENTHUB_NATIVE_VALIDATION_EXIT_CODE%.
  pause
)
exit /b %AGENTHUB_NATIVE_VALIDATION_EXIT_CODE%
"@
Set-Content -LiteralPath $validationStarterPath -Value $validationStarter -Encoding ASCII

Write-Host "AgentHub Native published to: $outputPath"
Write-Host "Run: $starterPath -Workspace V:\OrderManager -Agent codex -Resume"
Write-Host "Run without cmd: $powershellStarterPath -Workspace V:\OrderManager -Agent codex -Resume"
Write-Host "Diagnostics: $diagnosticsStarterPath -Workspace V:\OrderManager -Python `"py -3.11`""
Write-Host "Diagnostics without cmd: $powershellDiagnosticsStarterPath -Workspace V:\OrderManager -Python `"py -3.11`""
Write-Host "Validation: $validationStarterPath -Workspace V:\OrderManager -Python `"py -3.11`""
Write-Host "Validation without cmd: $powershellValidationPath -Workspace V:\OrderManager -Python `"py -3.11`""
