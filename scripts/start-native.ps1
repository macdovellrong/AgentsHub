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

function Split-AgentList {
    param(
        [string[]]$Agents
    )

    if ($null -eq $Agents) {
        return @()
    }

    $parsedAgents = @()
    foreach ($rawAgent in $Agents) {
        if ([string]::IsNullOrWhiteSpace($rawAgent)) {
            continue
        }

        foreach ($agentName in ($rawAgent -split ",")) {
            $trimmed = $agentName.Trim()
            if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
                $normalized = $trimmed.ToLowerInvariant()
                if ($normalized -eq "agents") {
                    $parsedAgents += @("codex", "claude", "gemini")
                }
                else {
                    $parsedAgents += $normalized
                }
            }
        }
    }

    return $parsedAgents
}

function Resolve-AgentCommandName {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AgentName
    )

    switch ($AgentName.ToLowerInvariant()) {
        "codex" { return "codex" }
        "claude" { return "claude" }
        "gemini" { return "gemini" }
        "powershell" { return $null }
        "cmd" { return $null }
        "shell" { return $null }
        default {
            throw "Unsupported Agent '$AgentName'. Supported values: codex, claude, gemini, powershell, cmd, shell."
        }
    }
}

function Test-AgentCommands {
    param(
        [string[]]$Agents
    )

    foreach ($agentName in (Split-AgentList -Agents $Agents)) {
        $commandName = Resolve-AgentCommandName -AgentName $agentName
        if ([string]::IsNullOrWhiteSpace($commandName)) {
            Write-Host "Agent CLI check skipped: $agentName uses the selected Host shell."
            continue
        }

        $command = Get-Command $commandName -ErrorAction SilentlyContinue
        if ($null -eq $command) {
            throw "Agent CLI '$commandName' was not found in PATH. Install it or update PATH before launching AgentHub Native."
        }

        Write-Host "Agent CLI check passed: $agentName"
        Write-Host "  $($command.Source)"
        Test-AgentCommandCapabilities -AgentName $agentName -CommandName $commandName
    }
}

function Test-AgentCommandCapabilities {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AgentName,
        [Parameter(Mandatory = $true)]
        [string]$CommandName
    )

    if ($AgentName.ToLowerInvariant() -ne "codex") {
        return
    }

    try {
        $output = & $CommandName --help 2>&1
    }
    catch {
        throw "Codex CLI help check could not be started: $($_.Exception.Message)"
    }

    $helpText = (@($output) -join "`n")
    if ($helpText -notlike "*--no-alt-screen*") {
        throw "Codex CLI does not support --no-alt-screen. Update Codex CLI before launching AgentHub Native Codex sessions."
    }

    Write-Host "Codex --no-alt-screen check passed."
}

function Test-AgentHooksRequired {
    param(
        [string[]]$Agents
    )

    foreach ($agentName in (Split-AgentList -Agents $Agents)) {
        $commandName = Resolve-AgentCommandName -AgentName $agentName
        if (-not [string]::IsNullOrWhiteSpace($commandName)) {
            return $true
        }
    }

    return $false
}

function Test-WorkspacePath {
    param(
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return
    }

    try {
        $resolvedPath = Convert-Path -LiteralPath $Path -ErrorAction Stop
    }
    catch {
        throw "Workspace path was not found or is not a directory: $Path"
    }

    if (-not (Test-Path -LiteralPath $resolvedPath -PathType Container)) {
        throw "Workspace path was not found or is not a directory: $Path"
    }

    Write-Host "Workspace check passed: $resolvedPath"
}

function Resolve-HostShellForCheck {
    param(
        [string]$Shell,
        [string[]]$Agents
    )

    if (-not [string]::IsNullOrWhiteSpace($Shell)) {
        return $Shell.ToLowerInvariant()
    }

    foreach ($agentName in (Split-AgentList -Agents $Agents)) {
        switch ($agentName) {
            "cmd" { return "cmd" }
            "powershell" { return "powershell" }
            "shell" { return "powershell" }
        }
    }

    return $null
}

function Test-HostShellCommand {
    param(
        [string]$Shell
    )

    if ([string]::IsNullOrWhiteSpace($Shell)) {
        return
    }

    switch ($Shell.ToLowerInvariant()) {
        "cmd" {
            $path = Join-Path ([Environment]::SystemDirectory) "cmd.exe"
        }
        "powershell" {
            $path = Join-Path ([Environment]::SystemDirectory) "WindowsPowerShell/v1.0/powershell.exe"
        }
        default {
            throw "Unsupported Host shell '$Shell'. Supported values: powershell, cmd."
        }
    }

    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Host shell executable was not found: $path"
    }

    Write-Host "Host shell check passed: $Shell"
    Write-Host "  $path"
}

function Test-HookScriptsDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DefaultHooksDirectory
    )

    $override = $env:AGENTHUB_HOOKS_SOURCE_DIR
    $hooksDirectory = if ([string]::IsNullOrWhiteSpace($override)) {
        $DefaultHooksDirectory
    }
    else {
        $override
    }

    $requiredScripts = @(
        "agenthub_hook_common.py",
        "agenthub_codex_stop.py",
        "agenthub_claude_stop.py",
        "agenthub_gemini_after_agent.py"
    )

    if (-not (Test-Path -LiteralPath $hooksDirectory -PathType Container)) {
        throw "AgentHub hook scripts directory was not found: $hooksDirectory"
    }

    foreach ($scriptName in $requiredScripts) {
        $scriptPath = Join-Path $hooksDirectory $scriptName
        if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
            throw "AgentHub hook script was not found: $scriptPath"
        }
    }

    Write-Host "Hook scripts check passed: $hooksDirectory"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$nativeProject = Join-Path $repoRoot "native/AgentHub.Native/src/AgentHub.Native.App/AgentHub.Native.App.csproj"
$hookScriptsDirectory = Join-Path $repoRoot "scripts/hooks"

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
    $requestedAgents = Split-AgentList -Agents $Agent
    Test-WorkspacePath -Path $Workspace
    Test-HostShellCommand -Shell (Resolve-HostShellForCheck -Shell $Shell -Agents $requestedAgents)

    $agentWasRequested = $requestedAgents.Count -gt 0
    $agentHooksRequired = $false
    if ($agentWasRequested) {
        Test-AgentCommands -Agents $requestedAgents
        $agentHooksRequired = Test-AgentHooksRequired -Agents $requestedAgents
    }

    if (-not [string]::IsNullOrWhiteSpace($Python)) {
        Test-HookPythonCommand -Command $Python
    }
    elseif ($agentHooksRequired) {
        Test-HookPythonCommand -Command "py -3.11"
    }

    if ($agentHooksRequired) {
        Test-HookScriptsDirectory -DefaultHooksDirectory $hookScriptsDirectory
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

    $agentList = (Split-AgentList -Agents $Agent) -join ","
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
