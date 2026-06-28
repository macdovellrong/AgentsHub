param(
    [switch]$Check,
    [Alias("w")]
    [string]$Workspace,
    [Alias("s")]
    [ValidateSet("powershell", "cmd")]
    [string]$Shell,
    [string]$Python,
    [Alias("a")]
    [string[]]$Agent,
    [switch]$Resume
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$nativeProject = Join-Path $repoRoot "native/AgentHub.Native/src/AgentHub.Native.App/AgentHub.Native.App.csproj"

if (-not (Test-Path -LiteralPath $nativeProject)) {
    throw "AgentHub Native project not found: $nativeProject"
}

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if ($null -eq $dotnet) {
    throw "dotnet was not found in PATH. Install the .NET 10 SDK, then run this script again."
}

$sdks = & dotnet --list-sdks
if (-not ($sdks | Where-Object { $_ -match "^(1[0-9]|[2-9][0-9])\." })) {
    throw ".NET 10 SDK or newer was not found. Install the .NET 10 SDK, then run this script again."
}

if ($Check) {
    Write-Host "AgentHub Native launch check passed."
    Write-Host "Project: $nativeProject"
    exit 0
}

Set-Location -LiteralPath $repoRoot
$runArgs = @("run", "--project", $nativeProject)
if (-not [string]::IsNullOrWhiteSpace($Workspace)) {
    $runArgs += @("--", "--workspace", $Workspace)
}
if (-not [string]::IsNullOrWhiteSpace($Shell)) {
    if (-not ($runArgs -contains "--")) {
        $runArgs += "--"
    }

    $runArgs += @("--shell", $Shell)
}
if (-not [string]::IsNullOrWhiteSpace($Python)) {
    if (-not ($runArgs -contains "--")) {
        $runArgs += "--"
    }

    $runArgs += @("--python", $Python)
}
if ($null -ne $Agent -and $Agent.Count -gt 0) {
    if (-not ($runArgs -contains "--")) {
        $runArgs += "--"
    }

    $agentList = ($Agent | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ","
    if (-not [string]::IsNullOrWhiteSpace($agentList)) {
        $runArgs += @("--agent", $agentList)
    }
}
if ($Resume) {
    if (-not ($runArgs -contains "--")) {
        $runArgs += "--"
    }

    $runArgs += "--resume"
}

& dotnet @runArgs
