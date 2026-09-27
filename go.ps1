[CmdletBinding()]
param(
    [int]$FrontendPort = 0,
    [int]$BackendPort = 0,
    [string]$Branch = "feature/on-demand-ingestion",
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

& $UpdateScript @PSBoundParameters
