$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $repoRoot "desktop"

if (-not (Test-Path -LiteralPath (Join-Path $desktop "package.json"))) {
    throw "Electron desktop package not found: $desktop"
}

$env:AGENTHUB_WORKSPACE = $repoRoot
Set-Location -LiteralPath $desktop
npm install
npm run dev
