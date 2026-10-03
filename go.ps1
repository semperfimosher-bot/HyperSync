[CmdletBinding()]
param(
    [int]$FrontendPort = 4153,
    [int]$BackendPort = 8000,
    [string]$Branch = "main",
    [switch]$NoBrowser,
    [switch]$SkipDependencies,
    [switch]$SkipMigrations
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$UpdateScript = Join-Path $PSScriptRoot "update-local.ps1"

if (-not (Test-Path -LiteralPath $UpdateScript)) {
    throw "update-local.ps1 was not found next to go.ps1."
}

if ($Branch -ne "main") {
    throw "go.ps1 is intentionally locked to GitHub main. Use update-local.ps1 directly only when you explicitly need another branch."
}

if ($FrontendPort -ne 4153) {
    throw "HyperSync local frontend is fixed to port 4153."
}

if ($BackendPort -ne 8000) {
    throw "HyperSync local backend is fixed to port 8000."
}

& $UpdateScript @PSBoundParameters
