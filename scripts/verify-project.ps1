$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path `
    -Parent `
    $PSScriptRoot

Set-Location $ProjectRoot


function Stop-Verification {
    param(
        [string]$CheckName,
        [object[]]$Output = @()
    )

    Write-Host ""
    Write-Host `
        "VERIFICATION FAILED: $CheckName" `
        -ForegroundColor Red

    if ($Output.Count -gt 0) {
        Write-Host ""

        foreach ($line in $Output) {
            Write-Host $line
        }
    }

    exit 1
}


function Invoke-NativeCheck {
    param(
        [string]$CheckName,
        [scriptblock]$Command
    )

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    try {
        $global:LASTEXITCODE = 0

        $output = @(
            & $Command 2>&1 |
                ForEach-Object {
                    $_.ToString()
                }
        )

        $exitCode = $LASTEXITCODE
    }
    catch {
        $output = @(
            $_.Exception.ToString()
        )

        $exitCode = 1
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }

    if ($exitCode -ne 0) {
        Stop-Verification `
            -CheckName "$CheckName (exit code $exitCode)" `
            -Output $output
    }
}


# ------------------------------------------------------------
# Required project files
# ------------------------------------------------------------

$requiredFiles = @(
    ".env",
    ".env.example",
    ".gitattributes",
    ".gitignore",
    "Dockerfile.backend",
    "README.md",
    "alembic.ini",
    "pyproject.toml",
    "pyrightconfig.json",
    "requirements.backend.txt",
    "requirements.dev.txt",
    "backend\__init__.py",
    "backend\app\__init__.py",
    "backend\app\main.py",
    "backend\app\config.py",
    "backend\app\database.py",
    "backend\app\api\router.py",
    "backend\app\api\routes\health.py",
    "backend\app\models\__init__.py",
    "backend\app\models\base.py",
    "backend\app\models\account.py",
    "migrations\env.py",
    "scripts\__init__.py",
    "scripts\check_schema.py",
    "tests\test_health.py",
    "tests\test_models.py",
    "frontend\Dockerfile",
    "frontend\package.json",
    "frontend\package-lock.json"
)

$missingFiles = @(
    $requiredFiles |
        Where-Object {
            -not (Test-Path $_)
        }
)

if ($missingFiles.Count -gt 0) {
    Stop-Verification `
        -CheckName "Required project files" `
        -Output @(
            "These files are missing:"
            $missingFiles
        )
}


# ------------------------------------------------------------
# Local Python environment
# ------------------------------------------------------------

$python = Join-Path `
    $ProjectRoot `
    ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    Stop-Verification `
        -CheckName "Python virtual environment" `
        -Output @(
            "Missing:"
            ".venv\Scripts\python.exe"
        )
}


# ------------------------------------------------------------
# Alembic structure
# ------------------------------------------------------------

$migrationFiles = @(
    Get-ChildItem `
        ".\migrations\versions\*.py" `
        -File `
        -ErrorAction SilentlyContinue
)

if ($migrationFiles.Count -eq 0) {
    Stop-Verification `
        -CheckName "Alembic migrations" `
        -Output @(
            "No migration files were found."
        )
}

$postWriteHookSections = @(
    Select-String `
        -Path ".\alembic.ini" `
        -Pattern "^\[post_write_hooks\]\s*$"
)

if ($postWriteHookSections.Count -ne 1) {
    Stop-Verification `
        -CheckName "Alembic post-write configuration" `
        -Output @(
            "Expected exactly one [post_write_hooks] section."
            "Found: $($postWriteHookSections.Count)"
        )
}


# ------------------------------------------------------------
# Git safety checks
# ------------------------------------------------------------

Invoke-NativeCheck `
    -CheckName ".env ignore rule" `
    -Command {
        git check-ignore -q .env
    }

$global:LASTEXITCODE = 0

$conflictOutput = @(
    git grep `
        -n `
        -E `
        "^(<<<<<<<|=======|>>>>>>>)" `
        -- `
        . 2>&1
)

$conflictExitCode = $LASTEXITCODE

# git grep returns:
# 0 when matches exist
# 1 when no matches exist
# Anything else means the command failed.
if ($conflictExitCode -eq 0) {
    Stop-Verification `
        -CheckName "Git conflict-marker scan" `
        -Output $conflictOutput
}

if ($conflictExitCode -ne 1) {
    Stop-Verification `
        -CheckName "Git conflict-marker scan command" `
        -Output $conflictOutput
}

$global:LASTEXITCODE = 0

$unmergedFiles = @(
    git diff `
        --name-only `
        --diff-filter=U 2>&1
)

if ($LASTEXITCODE -ne 0) {
    Stop-Verification `
        -CheckName "Git unmerged-file check" `
        -Output $unmergedFiles
}

if ($unmergedFiles.Count -gt 0) {
    Stop-Verification `
        -CheckName "Git unmerged files" `
        -Output $unmergedFiles
}

$global:LASTEXITCODE = 0

$forbiddenTrackedFiles = @(
    git ls-files `
        -- `
        ".env" `
        ":(glob).venv/**" `
        ":(glob)frontend/node_modules/**" `
        ":(glob)frontend/dist/**" 2>&1
)

if ($LASTEXITCODE -ne 0) {
    Stop-Verification `
        -CheckName "Tracked-file safety check" `
        -Output $forbiddenTrackedFiles
}

if ($forbiddenTrackedFiles.Count -gt 0) {
    Stop-Verification `
        -CheckName "Secret or generated files tracked by Git" `
        -Output $forbiddenTrackedFiles
}


# ------------------------------------------------------------
# Python dependencies and imports
# ------------------------------------------------------------

Invoke-NativeCheck `
    -CheckName "Python dependency consistency" `
    -Command {
        & $python -m pip check
    }

Invoke-NativeCheck `
    -CheckName "Backend import test" `
    -Command {
        & $python -m scripts.verify_backend
    }

# ------------------------------------------------------------
# Python linting, formatting, warnings, and syntax
# ------------------------------------------------------------

Invoke-NativeCheck `
    -CheckName "Ruff lint check" `
    -Command {
        & $python -m ruff check `
            backend `
            tests `
            scripts `
            migrations
    }

Invoke-NativeCheck `
    -CheckName "Ruff formatting check" `
    -Command {
        & $python -m ruff format `
            --check `
            backend `
            tests `
            scripts `
            migrations
    }

# -W error causes Python warnings during tests to fail verification.
Invoke-NativeCheck `
    -CheckName "Tests and Python warnings" `
    -Command {
        & $python -m pytest `
            -q `
            -W error
    }

Invoke-NativeCheck `
    -CheckName "Python syntax compilation" `
    -Command {
        & $python -m compileall `
            -q `
            backend `
            bot `
            scripts `
            migrations
    }


# ------------------------------------------------------------
# Alembic and Neon
# ------------------------------------------------------------

Invoke-NativeCheck `
    -CheckName "Alembic current revision" `
    -Command {
        & $python -m alembic current
    }

Invoke-NativeCheck `
    -CheckName "Alembic migration history" `
    -Command {
        & $python -m alembic history
    }

Invoke-NativeCheck `
    -CheckName "Models match the database" `
    -Command {
        & $python -m alembic check
    }

Invoke-NativeCheck `
    -CheckName "Neon schema verification" `
    -Command {
        & $python -m scripts.check_schema
    }


# ------------------------------------------------------------
# Frontend dependencies, build, and vulnerabilities
# ------------------------------------------------------------

Push-Location ".\frontend"

try {
    Invoke-NativeCheck `
        -CheckName "Frontend clean dependency installation" `
        -Command {
            npm.cmd ci
        }

    Invoke-NativeCheck `
        -CheckName "Frontend production build" `
        -Command {
            npm.cmd run build
        }

    # audit-level=low fails if npm reports any vulnerability level.
    Invoke-NativeCheck `
        -CheckName "Frontend dependency security audit" `
        -Command {
            npm.cmd audit `
                --audit-level=low
        }
}
finally {
    Pop-Location
}


# ------------------------------------------------------------
# Final Git whitespace check
# ------------------------------------------------------------

Invoke-NativeCheck `
    -CheckName "Git whitespace and patch validation" `
    -Command {
        cmd.exe `
            /d `
            /c `
            "git diff --check 2>&1"
    }

# This is printed only when every check above succeeded.
Write-Host `
    "All good Shane, hoorah" `
    -ForegroundColor Green

exit 0
