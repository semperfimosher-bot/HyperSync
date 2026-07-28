param(
    [string]$ProjectRoot = "C:\Users\TrojanIV\Desktop\HyperSync",
    [switch]$SkipDatabase
)

$ErrorActionPreference = "Continue"
$script:Failures = 0

function Pass([string]$Message) {
    Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Fail([string]$Message) {
    $script:Failures++
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

$resolved = Resolve-Path $ProjectRoot -ErrorAction SilentlyContinue
if ($null -eq $resolved) {
    throw "Project folder not found: $ProjectRoot"
}

$ProjectRoot = $resolved.Path
Set-Location $ProjectRoot

Write-Host ""
Write-Host "HyperSync verification" -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot"
Write-Host ""

$requiredFiles = @(
    ".env.example",
    "Dockerfile.backend",
    "requirements.backend.txt",
    "requirements.dev.txt",
    "backend\app\main.py",
    "backend\app\config.py",
    "backend\app\database.py",
    "frontend\Dockerfile",
    "frontend\package.json",
    "frontend\package-lock.json"
)

foreach ($file in $requiredFiles) {
    if (Test-Path $file) {
        Pass $file
    } else {
        Fail "Missing $file"
    }
}

$matches = @(
    Get-ChildItem $ProjectRoot -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object {
        $_.FullName -notlike "*\.git\*" -and
        $_.FullName -notlike "*\.venv\*" -and
        $_.FullName -notlike "*\node_modules\*" -and
        $_.FullName -notlike "*\dist\*"
    } |
    Select-String -Pattern "^(<<<<<<<|=======|>>>>>>>)" -ErrorAction SilentlyContinue
)

if ($matches.Count -eq 0) {
    Pass "No Git conflict markers"
} else {
    Fail "Git conflict markers found"
    foreach ($match in $matches) {
        $relativePath = $match.Path.Substring($ProjectRoot.Length + 1)
        Write-Host "  ${relativePath}:$($match.LineNumber)" -ForegroundColor Yellow
    }
}

$python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    Fail "Missing .venv\Scripts\python.exe"
} else {
    & $python -m pip check
    if ($LASTEXITCODE -eq 0) {
        Pass "Python dependencies"
    } else {
        Fail "Python dependencies"
    }

    & $python -m ruff check backend tests
    if ($LASTEXITCODE -eq 0) {
        Pass "Ruff"
    } else {
        Fail "Ruff"
    }

    & $python -m pytest -q
    if ($LASTEXITCODE -eq 0) {
        Pass "Pytest"
    } else {
        Fail "Pytest"
    }

    & $python -m compileall -q backend bot
    if ($LASTEXITCODE -eq 0) {
        Pass "Python syntax"
    } else {
        Fail "Python syntax"
    }

    if (-not $SkipDatabase) {
        $databaseCheck = "import asyncio; from backend.app.database import check_database; asyncio.run(check_database()); print('Database connection succeeded.')"

        & $python -c $databaseCheck
        if ($LASTEXITCODE -eq 0) {
            Pass "Neon database"
        } else {
            Fail "Neon database"
        }
    }
}

Push-Location (Join-Path $ProjectRoot "frontend")
try {
    & npm.cmd ci
    if ($LASTEXITCODE -eq 0) {
        Pass "npm ci"
    } else {
        Fail "npm ci"
    }

    & npm.cmd run build
    if ($LASTEXITCODE -eq 0) {
        Pass "Frontend build"
    } else {
        Fail "Frontend build"
    }
}
finally {
    Pop-Location
}

if (Test-Path ".git") {
    & git diff --check
    if ($LASTEXITCODE -eq 0) {
        Pass "Git diff check"
    } else {
        Fail "Git diff check"
    }
}

Write-Host ""
if ($script:Failures -gt 0) {
    Write-Host "HyperSync is not ready. Failures: $script:Failures" -ForegroundColor Red
    exit 1
}

Write-Host "HyperSync foundation is ready." -ForegroundColor Green
exit 0
