param(
    [string]$ProjectRoot = "",
    [switch]$SkipDatabase
)

$ErrorActionPreference = "Continue"
$script:Failures = 0

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path `
        -Parent `
        $PSScriptRoot
}

function Pass([string]$Message) {
    Write-Host `
        "[PASS] $Message" `
        -ForegroundColor Green
}

function Fail([string]$Message) {
    $script:Failures++

    Write-Host `
        "[FAIL] $Message" `
        -ForegroundColor Red
}

function Run-Check(
    [string]$Name,
    [scriptblock]$Command
) {
    & $Command

    if ($LASTEXITCODE -eq 0) {
        Pass $Name
    }
    else {
        Fail $Name
    }
}

$resolved = Resolve-Path `
    $ProjectRoot `
    -ErrorAction SilentlyContinue

if ($null -eq $resolved) {
    throw "Project folder not found: $ProjectRoot"
}

$ProjectRoot = $resolved.Path
Set-Location $ProjectRoot

Write-Host ""
Write-Host `
    "HyperSync verification" `
    -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot"
Write-Host ""

$requiredFiles = @(
    ".env.example",
    ".gitattributes",
    "Dockerfile.backend",
    "alembic.ini",
    "requirements.backend.txt",
    "requirements.dev.txt",
    "pyproject.toml",
    "backend\app\main.py",
    "backend\app\config.py",
    "backend\app\database.py",
    "backend\app\models\account.py",
    "migrations\env.py",
    "scripts\check_schema.py",
    "frontend\Dockerfile",
    "frontend\package.json",
    "frontend\package-lock.json"
)

foreach ($file in $requiredFiles) {
    if (Test-Path $file) {
        Pass $file
    }
    else {
        Fail "Missing $file"
    }
}

$migrationFiles = @(
    Get-ChildItem `
        ".\migrations\versions\*.py" `
        -File `
        -ErrorAction SilentlyContinue
)

if ($migrationFiles.Count -gt 0) {
    Pass "Alembic migration files"
}
else {
    Fail "No Alembic migration files found"
}

$matches = @(
    Get-ChildItem `
        $ProjectRoot `
        -Recurse `
        -File `
        -Force `
        -ErrorAction SilentlyContinue |
    Where-Object {
        $_.FullName -notlike "*\.git\*" -and
        $_.FullName -notlike "*\.venv\*" -and
        $_.FullName -notlike "*\node_modules\*" -and
        $_.FullName -notlike "*\dist\*" -and
        $_.FullName -notlike "*\__pycache__\*"
    } |
    Select-String `
        -Pattern "^(<<<<<<<|=======|>>>>>>>)" `
        -ErrorAction SilentlyContinue
)

if ($matches.Count -eq 0) {
    Pass "No Git conflict markers"
}
else {
    Fail "Git conflict markers found"

    foreach ($match in $matches) {
        $relativePath = $match.Path.Substring(
            $ProjectRoot.Length + 1
        )

        Write-Host `
            "  ${relativePath}:$($match.LineNumber)" `
            -ForegroundColor Yellow
    }
}

$python = Join-Path `
    $ProjectRoot `
    ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    Fail "Missing .venv\Scripts\python.exe"
}
else {
    Run-Check "Python dependencies" {
        & $python -m pip check
    }

    Run-Check "Ruff lint" {
        & $python -m ruff check `
            backend `
            tests `
            scripts `
            migrations
    }

    Run-Check "Ruff formatting" {
        & $python -m ruff format `
            --check `
            backend `
            tests `
            scripts `
            migrations
    }

    Run-Check "Pytest" {
        & $python -m pytest -q
    }

    Run-Check "Python syntax" {
        & $python -m compileall `
            -q `
            backend `
            bot `
            scripts `
            migrations
    }

    if (-not $SkipDatabase) {
        Run-Check "Alembic current" {
            & $python -m alembic current
        }

        Run-Check "Alembic model check" {
            & $python -m alembic check
        }

        Run-Check "Neon account schema" {
            & $python -m scripts.check_schema
        }
    }
}

Push-Location (
    Join-Path $ProjectRoot "frontend"
)

try {
    Run-Check "npm ci" {
        & npm.cmd ci
    }

    Run-Check "Frontend build" {
        & npm.cmd run build
    }
}
finally {
    Pop-Location
}

if (Test-Path ".git") {
    Run-Check "Git diff check" {
        & git diff --check
    }
}

Write-Host ""

if ($script:Failures -gt 0) {
    Write-Host `
        "HyperSync is not ready. Failures: $script:Failures" `
        -ForegroundColor Red

    exit 1
}

Write-Host `
    "HyperSync foundation is ready." `
    -ForegroundColor Green

exit 0