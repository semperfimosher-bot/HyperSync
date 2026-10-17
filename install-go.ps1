[CmdletBinding()]
param(
    [switch]$Quiet,
    [string]$RepositoryRoot = $PSScriptRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$localAppData = [string]$env:LOCALAPPDATA
if ([string]::IsNullOrWhiteSpace($localAppData)) {
    $localAppData = Join-Path $HOME ".hypersync"
}
$binRoot = Join-Path $localAppData "HyperSync/bin"
New-Item -ItemType Directory -Path (Join-Path $binRoot "scripts") -Force | Out-Null

# Keep the launcher outside Git so checking out an older branch cannot pin
# future go invocations back to PERFECT/main. Retain the installed copies when
# the selected branch predates this updater.
$bootstrapFiles = @("go.ps1", "install-go.ps1", "scripts/update_checkout.py")
$sourceComplete = $true
foreach ($relativePath in $bootstrapFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot $relativePath))) {
        $sourceComplete = $false
    }
}
foreach ($relativePath in $bootstrapFiles) {
    $destination = Join-Path $binRoot $relativePath
    if ($sourceComplete) {
        $source = Join-Path $RepoRoot $relativePath
        if (-not [string]::Equals($source, $destination, [System.StringComparison]::OrdinalIgnoreCase)) {
            Copy-Item -LiteralPath $source -Destination $destination -Force
        }
    }
    if (-not (Test-Path -LiteralPath $destination)) {
        throw "The go bootstrap is incomplete. Install from a checkout containing the latest launcher."
    }
}
$GoScript = Join-Path $binRoot "go.ps1"
$escapedRepoRoot = $RepoRoot.Replace("'", "''")

$escapedGoScript = $GoScript.Replace("'", "''")

$profilePath = $PROFILE.CurrentUserAllHosts

if ([string]::IsNullOrWhiteSpace($profilePath)) {
    $profilePath = [string]$PROFILE
}

$profileDirectory = Split-Path -Parent $profilePath

if (-not (Test-Path -LiteralPath $profileDirectory)) {
    New-Item -ItemType Directory -Path $profileDirectory -Force | Out-Null
}

$beginMarker = "# >>> HyperSync go command >>>"
$endMarker = "# <<< HyperSync go command <<<"

$profileBlock = @"
$beginMarker
function global:go {
    & '$escapedGoScript' -RepositoryRoot '$escapedRepoRoot' @args
}
$endMarker
"@

$existingContent = ""

if (Test-Path -LiteralPath $profilePath) {
    $existingContent = Get-Content -LiteralPath $profilePath -Raw -ErrorAction Stop
}

$pattern = (
    [regex]::Escape($beginMarker) +
    ".*?" +
    [regex]::Escape($endMarker)
)

if (
    [regex]::IsMatch(
        $existingContent,
        $pattern,
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
) {
    $nextContent = [regex]::Replace(
        $existingContent,
        $pattern,
        $profileBlock,
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
}
else {
    $separator = ""

    if (-not [string]::IsNullOrEmpty($existingContent)) {
        if (-not $existingContent.EndsWith([Environment]::NewLine)) {
            $separator = [Environment]::NewLine
        }

        $separator += [Environment]::NewLine
    }

    $nextContent = (
        $existingContent +
        $separator +
        $profileBlock +
        [Environment]::NewLine
    )
}

if ($nextContent -ne $existingContent) {
    Set-Content -LiteralPath $profilePath -Value $nextContent -Encoding UTF8
}

$global:HyperSyncGoScript = $GoScript
$global:HyperSyncRepositoryRoot = $RepoRoot

function global:go {
    & $global:HyperSyncGoScript -RepositoryRoot $global:HyperSyncRepositoryRoot @args
}

$goCmdPath = Join-Path $binRoot "go.cmd"
$escapedForCmd = $GoScript.Replace('"', '""')
$escapedRepoForCmd = $RepoRoot.Replace('"', '""')

$goCmd = @"
@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$escapedForCmd" -RepositoryRoot "$escapedRepoForCmd" %*
exit /b %ERRORLEVEL%
"@

Set-Content -LiteralPath $goCmdPath -Value $goCmd -Encoding ASCII

$userPath = [Environment]::GetEnvironmentVariable(
    "Path",
    "User"
)

$userPathParts = @(
    ([string]$userPath) -split ";" |
        Where-Object {
            -not [string]::IsNullOrWhiteSpace($_)
        }
)

$pathAlreadyInstalled = $false

foreach ($pathPart in $userPathParts) {
    if (
        [string]::Equals(
            $pathPart.TrimEnd("\"),
            $binRoot.TrimEnd("\"),
            [System.StringComparison]::OrdinalIgnoreCase
        )
    ) {
        $pathAlreadyInstalled = $true
        break
    }
}

if (-not $pathAlreadyInstalled) {
    $newUserPath = (
        @($binRoot) +
        $userPathParts
    ) -join ";"

    [Environment]::SetEnvironmentVariable(
        "Path",
        $newUserPath,
        "User"
    )
}

$currentPathParts = @(
    ([string]$env:Path) -split ";"
)

$currentPathHasBin = $false

foreach ($pathPart in $currentPathParts) {
    if (
        [string]::Equals(
            $pathPart.TrimEnd("\"),
            $binRoot.TrimEnd("\"),
            [System.StringComparison]::OrdinalIgnoreCase
        )
    ) {
        $currentPathHasBin = $true
        break
    }
}

if (-not $currentPathHasBin) {
    $env:Path = $binRoot + ";" + $env:Path
}

if (-not $Quiet) {
    Write-Host ""
    Write-Host "HyperSync 'go' command installed." -ForegroundColor Green
    Write-Host ("PowerShell profile: " + $profilePath) -ForegroundColor DarkGray
    Write-Host ("Command shim:       " + $goCmdPath) -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "You can now run:" -ForegroundColor Cyan
    Write-Host "  go" -ForegroundColor Green
    Write-Host ""
}
