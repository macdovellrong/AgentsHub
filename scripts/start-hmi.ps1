$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"
$src = Join-Path $repoRoot "src"

if (-not (Test-Path -LiteralPath $python)) {
    throw "Python virtual environment not found: $python"
}

Set-Location -LiteralPath $repoRoot
$env:PYTHONPATH = $src
& $python -m agenthub.main hmi
