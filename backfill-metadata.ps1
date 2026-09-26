$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
$ScriptPath = Join-Path $RepoRoot "scripts\backfill_track_metadata.py"

if (Test-Path -LiteralPath $VenvPython) {
    $Python = $VenvPython
}
else {
    $PythonCommand = Get-Command python -ErrorAction SilentlyContinue

    if (-not $PythonCommand) {
        throw "Python was not found. Run .\update-local.ps1 once to prepare the HyperSync environment."
    }

    $Python = $PythonCommand.Source
}

if (-not (Test-Path -LiteralPath $ScriptPath)) {
    throw "Metadata backfill script was not found: $ScriptPath"
}

Write-Host ""
Write-Host "=== HyperSync Genre + Release Year Backfill ===" -ForegroundColor Cyan
Write-Host "Only missing genre/release_year fields are changed." -ForegroundColor DarkGray
Write-Host ""

& $Python $ScriptPath @args
exit $LASTEXITCODE
