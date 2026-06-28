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

if (-not (Test-Path -LiteralPath $nativeProject)) {
    throw "AgentHub Native project not found: $nativeProject"
}

if (-not (Test-Path -LiteralPath (Join-Path $hookSource "agenthub_hook_common.py"))) {
    throw "AgentHub hook scripts not found: $hookSource"
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

$starterPath = Join-Path $outputPath "start-agenthub-native.bat"
$starter = @"
@echo off
setlocal
pushd "%~dp0" || exit /b 1
AgentHub.Native.App.exe %*
set "AGENTHUB_NATIVE_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %AGENTHUB_NATIVE_EXIT_CODE%
"@
Set-Content -LiteralPath $starterPath -Value $starter -Encoding ASCII

Write-Host "AgentHub Native published to: $outputPath"
Write-Host "Run: $starterPath -Workspace V:\OrderManager -Agent codex -Resume"
