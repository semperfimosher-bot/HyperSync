[CmdletBinding()]
param(
    [int]$FrontendPort = 4153,
    [int]$BackendPort = 8000,
    [string]$Branch = "",
    [switch]$NoBrowser,
    [switch]$SkipDependencies,
    [switch]$SkipMigrations,
    [switch]$AfterGitUpdate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path

$FrontendRoot = Join-Path $RepoRoot "frontend"
$VenvRoot = Join-Path $RepoRoot ".venv"
$PythonPath = Join-Path $VenvRoot "Scripts\python.exe"
$BackendRequirements = Join-Path $RepoRoot "requirements.backend.txt"
$PackageJson = Join-Path $FrontendRoot "package.json"
$PackageLock = Join-Path $FrontendRoot "package-lock.json"
$RebootScript = Join-Path $RepoRoot "reboot-local.ps1"
$InstallGoScript = Join-Path $RepoRoot "install-go.ps1"

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
        # Install the committed lockfile without rewriting tracked dependency files.
        Invoke-CheckedCommand -FilePath $npmCommand.Source -Arguments @(
            "ci",
            "--no-audit",
            "--no-fund"
        ) -FailureMessage "npm ci failed."
    }
    finally {
        Pop-Location
    }
}

function Update-DatabaseSchema {
    Push-Location $RepoRoot

    try {
        $databaseKind = (
            & $PythonPath -c (
                "from backend.app.config import get_settings; " +
                "u=get_settings().sqlalchemy_migration_url; " +
                "print('postgresql' if u else 'none')"
            )
        ).Trim()

        if ($LASTEXITCODE -ne 0) {
            throw "Could not inspect local database configuration."
        }
    }
    finally {
        Pop-Location
    }

    if ($databaseKind -eq "postgresql") {
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
    # Direct callers use the same branch policy and safety checks as plain go.
    $goParameters = @{
        FrontendPort = $FrontendPort
        BackendPort = $BackendPort
        Branch = $Branch
        NoBrowser = $NoBrowser
        SkipDependencies = $SkipDependencies
        SkipMigrations = $SkipMigrations
        RepositoryRoot = $RepoRoot
    }
    & (Join-Path $RepoRoot "go.ps1") @goParameters
    return
}

Push-Location $RepoRoot
try {
    $commitLabel = Get-GitOutput -Arguments @("log", "-1", "--oneline")
    Write-Host ("Starting fetched branch " + $Branch + ": " + $commitLabel) -ForegroundColor Cyan
}
finally {
    Pop-Location
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


if (Test-Path -LiteralPath $InstallGoScript) {
    & $InstallGoScript -Quiet
}

$rebootParameters = @{
    FrontendPort = $FrontendPort
    BackendPort = $BackendPort
    NoBrowser = $NoBrowser
}

& $RebootScript @rebootParameters
