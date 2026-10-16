[CmdletBinding()]
param(
    [int]$FrontendPort = 4153,
    [int]$BackendPort = 8000,
    [string]$Branch = "PERFECT",
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

if ($Branch -ne "PERFECT") {
    throw "go.ps1 is intentionally locked to the PERFECT baseline branch."
}

if ($FrontendPort -ne 4153) {
    throw "HyperSync local frontend is fixed to port 4153."
}

if ($BackendPort -ne 8000) {
    throw "HyperSync local backend is fixed to port 8000."
}

# Pass every parameter explicitly. @PSBoundParameters omits default-valued
# parameters that the caller did not type, which previously let update-local
# fall back to its own default branch ("main").
$updateParameters = @{
    FrontendPort = $FrontendPort
    BackendPort = $BackendPort
    Branch = $Branch
    NoBrowser = $NoBrowser
    SkipDependencies = $SkipDependencies
    SkipMigrations = $SkipMigrations
}

& $UpdateScript @updateParameters
