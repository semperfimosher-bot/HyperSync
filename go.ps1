[CmdletBinding()]
param(
    [int]$FrontendPort = 4153,
    [int]$BackendPort = 8000,
    [string]$Branch = "",
    [switch]$NoBrowser,
    [switch]$SkipDependencies,
    [switch]$SkipMigrations,
    [string]$RepositoryRoot = $PSScriptRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path

if ($FrontendPort -ne 4153 -or $BackendPort -ne 8000) {
    throw "HyperSync local ports are fixed to frontend 4153 and backend 8000."
}

$installer = Join-Path $PSScriptRoot "install-go.ps1"
$checkoutHelper = Join-Path $PSScriptRoot "scripts/update_checkout.py"
if (-not (Test-Path -LiteralPath $installer) -or -not (Test-Path -LiteralPath $checkoutHelper)) {
    throw "The go launcher is incomplete. Update this checkout and run install-go.ps1 once."
}

# Persist the updater before changing branches: an older checkout may contain
# the former PERFECT-only go script, or may not contain the Python helper at all.
& $installer -RepositoryRoot $RepoRoot -Quiet
$stableInstaller = Join-Path (Split-Path -Parent $global:HyperSyncGoScript) "install-go.ps1"

$pythonCommand = $null
$pythonArguments = @()
$venvPython = Join-Path $RepoRoot ".venv/Scripts/python.exe"
if (Test-Path -LiteralPath $venvPython) {
    $pythonCommand = Get-Command $venvPython -ErrorAction Stop
}
else {
    foreach ($candidate in @("py.exe", "python.exe", "python")) {
        $pythonCommand = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($null -ne $pythonCommand) {
            if ($candidate -eq "py.exe") { $pythonArguments += "-3" }
            break
        }
    }
}
if ($null -eq $pythonCommand) {
    throw "Python 3 was not found. Install Python, then run go again."
}

Write-Host "Fetching origin and selecting the latest checkout..." -ForegroundColor Cyan
$pythonArguments += @($checkoutHelper, "--repo", $RepoRoot)
if (-not [string]::IsNullOrWhiteSpace($Branch)) {
    $pythonArguments += @("--branch", $Branch.Trim())
}
$selectionJson = @(& $pythonCommand.Source @pythonArguments) -join [Environment]::NewLine
if ($LASTEXITCODE -ne 0) {
    throw "The Git update stopped. HyperSync was not started; local work was preserved."
}
$selection = $selectionJson | ConvertFrom-Json
Write-Host ("Branch: " + $selection.branch) -ForegroundColor Green
Write-Host ("Commit: " + $selection.commit) -ForegroundColor Green

$updateParameters = @{
    FrontendPort = $FrontendPort
    BackendPort = $BackendPort
    Branch = $selection.branch
    NoBrowser = $NoBrowser
    SkipDependencies = $SkipDependencies
    SkipMigrations = $SkipMigrations
    AfterGitUpdate = $true
}
try {
    # Load the freshly fetched updater, never the copy loaded before checkout.
    & (Join-Path $RepoRoot "update-local.ps1") @updateParameters
}
finally {
    # Older branches may reinstall their old shim during startup. Restore the
    # persistent updater so the NEXT go still selects the newest remote tip.
    & $stableInstaller -RepositoryRoot $RepoRoot -Quiet
}
