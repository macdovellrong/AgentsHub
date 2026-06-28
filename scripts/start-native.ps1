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

    $probe = "import sys; print(sys.executable); print(sys.version.split()[0])"
    try {
        $output = & $parsed.Executable @($parsed.Arguments) -c $probe 2>&1
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
    $agentWasRequested = $null -ne $Agent -and $Agent.Count -gt 0
    if (-not [string]::IsNullOrWhiteSpace($Python)) {
        Test-HookPythonCommand -Command $Python
    }
    elseif ($agentWasRequested) {
        Test-HookPythonCommand -Command "py -3"
    }

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
