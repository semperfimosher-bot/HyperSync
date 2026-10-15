[CmdletBinding()]
param(
    [int]$FrontendPort = 4153,
    [int]$BackendPort = 8000,
    [string]$Branch = "fix/docker-direct-upload-cors-resilience",
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

$LatestChangeBranch = "fix/docker-direct-upload-cors-resilience"

if ($Branch -ne $LatestChangeBranch) {
    throw "go.ps1 is locked to the latest HyperSync change branch: $LatestChangeBranch."
}

if ($FrontendPort -ne 4153) {
    throw "HyperSync local frontend is fixed to port 4153."
}

if ($BackendPort -ne 8000) {
    throw "HyperSync local backend is fixed to port 8000."
}

& $UpdateScript @PSBoundParameters
