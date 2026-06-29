param(
    [string]$Workspace,
    [string[]]$Agent = @("codex"),
    [string]$Python = "py -3.11",
    [string]$Output
)

$ErrorActionPreference = "Stop"

function Resolve-ValidationOutputPath {
    param(
        [string]$OutputPath,
        [string]$RepositoryRoot
    )

    if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
        return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
    }

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $defaultOutputPath = Join-Path $RepositoryRoot "artifacts/native-diagnostics/laptop-validation-$timestamp.md"
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

$repoRoot = Split-Path -Parent $PSScriptRoot
$startNativeScript = Join-Path $repoRoot "scripts/start-native.ps1"
$diagnosticsScript = Join-Path $repoRoot "scripts/collect-native-diagnostics.ps1"
$resolvedOutput = Resolve-ValidationOutputPath -OutputPath $Output -RepositoryRoot $repoRoot

if (-not (Test-Path -LiteralPath $startNativeScript -PathType Leaf)) {
    throw "AgentHub Native start script not found: $startNativeScript"
}

if (-not (Test-Path -LiteralPath $diagnosticsScript -PathType Leaf)) {
    throw "AgentHub Native diagnostics script not found: $diagnosticsScript"
}

$script:ValidationSteps = @()
$script:ValidationHadFailure = $false
$agentLabel = $Agent -join ","

Invoke-ValidationStep "powershell $agentLabel preflight" {
    & $startNativeScript -Check -Workspace $Workspace -Shell powershell -Agent $Agent -Python $Python
}

Invoke-ValidationStep "cmd $agentLabel preflight" {
    & $startNativeScript -Check -Workspace $Workspace -Shell cmd -Agent $Agent -Python $Python
}

Invoke-ValidationStep "scrolltest preflight" {
    & $startNativeScript -Check -Workspace $Workspace -Agent scrolltest
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
