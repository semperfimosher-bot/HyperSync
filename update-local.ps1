[CmdletBinding()]
param(
    [int]$FrontendPort = 4153,
    [int]$BackendPort = 8000,
    [string]$Branch = "main",
    [switch]$NoBrowser,
    [switch]$SkipDependencies,
    [switch]$SkipMigrations,
    [switch]$AfterGitUpdate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path

if ([string]::IsNullOrWhiteSpace($Branch)) {
    throw "A Git branch name is required."
}

$Branch = $Branch.Trim()
$FrontendRoot = Join-Path $RepoRoot "frontend"
$VenvRoot = Join-Path $RepoRoot ".venv"
$PythonPath = Join-Path $VenvRoot "Scripts\python.exe"
$BackendRequirements = Join-Path $RepoRoot "requirements.backend.txt"
$PackageJson = Join-Path $FrontendRoot "package.json"
$PackageLock = Join-Path $FrontendRoot "package-lock.json"
$RebootScript = Join-Path $RepoRoot "reboot-local.ps1"
$InstallGoScript = Join-Path $RepoRoot "install-go.ps1"
$ReadinessScript = Join-Path $RepoRoot "scripts\local_on_demand_readiness.py"

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [Parameter(Mandatory = $true)]
        [string]$FailureMessage
    )

    & $FilePath @Arguments

    if ($LASTEXITCODE -ne 0) {
        throw $FailureMessage
    }
}

function Get-GitOutput {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $output = & $script:GitPath @Arguments

    if ($LASTEXITCODE -ne 0) {
        throw (
            "Git command failed: git " +
            ($Arguments -join " ")
        )
    }

    return (
        @($output) -join [Environment]::NewLine
    ).Trim()
}

function Ensure-PythonEnvironment {
    if (Test-Path -LiteralPath $PythonPath) {
        return
    }

    Write-Host ""
    Write-Host "Creating HyperSync Python virtual environment..." -ForegroundColor Yellow

    $pyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue

    if ($null -ne $pyLauncher) {
        Invoke-CheckedCommand -FilePath $pyLauncher.Source -Arguments @(
            "-3",
            "-m",
            "venv",
            $VenvRoot
        ) -FailureMessage "Could not create .venv with the Python launcher."
    }
    else {
        $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue

        if ($null -eq $pythonCommand) {
            $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
        }

        if ($null -eq $pythonCommand) {
            throw "Python was not found. Install Python 3, then run go again."
        }

        Invoke-CheckedCommand -FilePath $pythonCommand.Source -Arguments @(
            "-m",
            "venv",
            $VenvRoot
        ) -FailureMessage "Could not create .venv."
    }

    if (-not (Test-Path -LiteralPath $PythonPath)) {
        throw "Python virtual environment creation did not produce .venv\Scripts\python.exe."
    }
}

function Update-BackendDependencies {
    if (-not (Test-Path -LiteralPath $BackendRequirements)) {
        throw "requirements.backend.txt was not found."
    }

    Write-Host ""
    Write-Host "Checking backend dependencies..." -ForegroundColor Yellow

    Invoke-CheckedCommand -FilePath $PythonPath -Arguments @(
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--requirement",
        $BackendRequirements
    ) -FailureMessage "Backend dependency installation failed."
}

function Update-FrontendDependencies {
    if (
        -not (Test-Path -LiteralPath $PackageJson) -or
        -not (Test-Path -LiteralPath $PackageLock)
    ) {
        throw "frontend/package.json or frontend/package-lock.json was not found."
    }

    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue

    if ($null -eq $npmCommand) {
        $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
    }

    if ($null -eq $npmCommand) {
        throw "npm was not found in PATH."
    }

    Write-Host ""
    Write-Host "Checking frontend dependencies..." -ForegroundColor Yellow

    Push-Location $FrontendRoot

    try {
        $nodeModules = Join-Path $FrontendRoot "node_modules"

        if (Test-Path -LiteralPath $nodeModules) {
            Invoke-CheckedCommand -FilePath $npmCommand.Source -Arguments @(
                "install",
                "--no-audit",
                "--no-fund"
            ) -FailureMessage "npm install failed."
        }
        else {
            Invoke-CheckedCommand -FilePath $npmCommand.Source -Arguments @(
                "ci",
                "--no-audit",
                "--no-fund"
            ) -FailureMessage "npm ci failed."
        }
    }
    finally {
        Pop-Location
    }
}

function Get-OnDemandReadinessValues {
    if (-not (Test-Path -LiteralPath $ReadinessScript)) {
        throw (
            "Local readiness helper was not found at " +
            $ReadinessScript
        )
    }

    Push-Location $RepoRoot

    try {
        $probeOutput = @(
            & $PythonPath $ReadinessScript
        )

        if ($LASTEXITCODE -ne 0) {
            throw "Could not inspect local on-demand configuration."
        }
    }
    finally {
        Pop-Location
    }

    $values = @{}

    foreach ($line in $probeOutput) {
        $parts = ([string]$line).Split("=", 2)

        if ($parts.Count -eq 2) {
            $values[$parts[0]] = $parts[1]
        }
    }

    return $values
}

function Show-OnDemandReadiness {
    try {
        $values = Get-OnDemandReadinessValues
    }
    catch {
        Write-Warning (
            "Could not display the optional local readiness summary: " +
            $_.Exception.Message
        )

        return
    }

    Write-Host ""
    Write-Host "Local on-demand readiness:" -ForegroundColor Cyan
    Write-Host ("  Database:        " + $values["database"]) -ForegroundColor DarkGray
    Write-Host "  Deezer + iTunes: ready (no API key required)" -ForegroundColor Green
    Write-Host "  yt-dlp:          installed with backend dependencies" -ForegroundColor Green

    if ($values["b2"] -eq "ready") {
        Write-Host "  B2 publishing:   ready" -ForegroundColor Green
    }
    else {
        Write-Warning (
            "B2 publishing is not fully configured in backend/.env. " +
            "Search and temporary on-demand playback can still work, " +
            "but permanent ingest cannot finish until B2_ENDPOINT, " +
            "B2_KEY_ID, B2_APPLICATION_KEY, and B2_BUCKET_NAME are set."
        )
    }

    if ($values["cookies"] -eq "configured-but-missing") {
        Write-Warning "YT_DLP_COOKIES_FILE is configured but the file does not exist."
    }
    elseif ($values["cookies"] -eq "ready") {
        Write-Host "  yt-dlp cookies:  ready" -ForegroundColor Green
    }
    else {
        Write-Host "  yt-dlp cookies:  optional / not configured" -ForegroundColor DarkGray
    }

    if ($values["admin"] -eq "ready") {
        Write-Host "  Admin setup:     ready" -ForegroundColor Green
    }
    else {
        Write-Host "  Admin setup:     existing admins can sign in; creation secret is not set" -ForegroundColor DarkGray
    }
}

function Update-DatabaseSchema {
    Push-Location $RepoRoot

    try {
        $databaseKind = (
            & $PythonPath -c (
                "from backend.app.config import get_settings; " +
                "u=get_settings().sqlalchemy_migration_url; " +
                "print('none' if not u else ('sqlite' if u.startswith('sqlite') else 'remote'))"
            )
        ).Trim()

        if ($LASTEXITCODE -ne 0) {
            throw "Could not inspect local database configuration."
        }
    }
    finally {
        Pop-Location
    }

    if ($databaseKind -eq "remote") {
        Write-Host ""
        Write-Host "Applying database migrations..." -ForegroundColor Yellow

        Push-Location $RepoRoot

        try {
            Invoke-CheckedCommand -FilePath $PythonPath -Arguments @(
                "-m",
                "alembic",
                "upgrade",
                "head"
            ) -FailureMessage "Database migration failed."
        }
        finally {
            Pop-Location
        }

        Write-Host "Database is at the latest migration." -ForegroundColor Green
        return
    }

    if ($databaseKind -eq "sqlite") {
        throw (
            "SQLite is not permitted for normal local development. " +
            "Set DATABASE_URL to the Neon PostgreSQL runtime connection string " +
            "in backend/.env, then run go again."
        )
    }

    throw (
        "DATABASE_URL is not configured. " +
        "Local HyperSync development requires the real Neon PostgreSQL database. " +
        "Set DATABASE_URL in backend/.env, then run go again."
    )
}

Write-Host ""
Write-Host "=== HyperSync Update + Clean Reboot ===" -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot ".git"))) {
    throw (
        "This script must live in the HyperSync Git repository root. " +
        "Expected .git under " +
        $RepoRoot
    )
}

$gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue

if ($null -eq $gitCommand) {
    $gitCommand = Get-Command git -ErrorAction SilentlyContinue
}

if ($null -eq $gitCommand) {
    throw "Git was not found in PATH."
}

$script:GitPath = $gitCommand.Source

if (-not $AfterGitUpdate) {
    Push-Location $RepoRoot

try {
    $unmergedFiles = @(
        & $script:GitPath diff --name-only --diff-filter=U
    )

    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect the Git working tree."
    }

    if ($unmergedFiles.Count -gt 0) {
        Write-Host ""
        Write-Host "Git has unresolved merge conflicts:" -ForegroundColor Red

        foreach ($file in $unmergedFiles) {
            Write-Host ("  " + $file) -ForegroundColor Red
        }

        throw "Resolve the merge conflict before running go."
    }

    $beforeCommit = Get-GitOutput -Arguments @(
        "rev-parse",
        "HEAD"
    )

    Write-Host ""
    Write-Host ("Fetching latest " + $Branch + "...") -ForegroundColor Yellow

    Invoke-CheckedCommand -FilePath $script:GitPath -Arguments @(
        "fetch",
        "--prune",
        "origin",
        $Branch
    ) -FailureMessage "Git fetch failed."

    & $script:GitPath show-ref --verify --quiet ("refs/heads/" + $Branch)
    $localBranchExists = ($LASTEXITCODE -eq 0)

    if ($localBranchExists) {
        Invoke-CheckedCommand -FilePath $script:GitPath -Arguments @(
            "switch",
            $Branch
        ) -FailureMessage ("Could not switch to " + $Branch + ".")
    }
    else {
        Invoke-CheckedCommand -FilePath $script:GitPath -Arguments @(
            "switch",
            "--track",
            "-c",
            $Branch,
            ("origin/" + $Branch)
        ) -FailureMessage ("Could not create local tracking branch " + $Branch + ".")
    }

    Invoke-CheckedCommand -FilePath $script:GitPath -Arguments @(
        "pull",
        "--ff-only",
        "origin",
        $Branch
    ) -FailureMessage (
        "Git update failed. Your local changes were not discarded. " +
        "Resolve any reported Git issue, then run go again."
    )

    $afterCommit = Get-GitOutput -Arguments @(
        "rev-parse",
        "HEAD"
    )

    $commitLabel = Get-GitOutput -Arguments @(
        "log",
        "-1",
        "--oneline"
    )

    Write-Host ""
    Write-Host ("Current commit: " + $commitLabel) -ForegroundColor Cyan

    if ($beforeCommit -eq $afterCommit) {
        Write-Host "Already on the latest branch commit." -ForegroundColor DarkGray
    }
    else {
        Write-Host "Local checkout updated successfully." -ForegroundColor Green
    }
}
    finally {
        Pop-Location
    }

    if ($beforeCommit -ne $afterCommit) {
        Write-Host ""
        Write-Host "Reloading the freshly updated local helper..." -ForegroundColor Yellow

        $nextParameters = @{
            FrontendPort = $FrontendPort
            BackendPort = $BackendPort
            Branch = $Branch
            NoBrowser = $NoBrowser
            SkipDependencies = $SkipDependencies
            SkipMigrations = $SkipMigrations
            AfterGitUpdate = $true
        }

        & $PSCommandPath @nextParameters
        return
    }
}
else {
    Push-Location $RepoRoot

    try {
        $commitLabel = Get-GitOutput -Arguments @(
            "log",
            "-1",
            "--oneline"
        )

        Write-Host ""
        Write-Host ("Using freshly updated commit: " + $commitLabel) -ForegroundColor Cyan
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath $RebootScript)) {
    throw "reboot-local.ps1 was not found."
}

& $RebootScript -StopOnly

Ensure-PythonEnvironment

if (-not $SkipDependencies) {
    Update-BackendDependencies
    Update-FrontendDependencies
}

if (-not $SkipMigrations) {
    Update-DatabaseSchema
}

Show-OnDemandReadiness

if (Test-Path -LiteralPath $InstallGoScript) {
    & $InstallGoScript -Quiet
}

$rebootParameters = @{
    FrontendPort = $FrontendPort
    BackendPort = $BackendPort
    NoBrowser = $NoBrowser
}

& $RebootScript @rebootParameters
